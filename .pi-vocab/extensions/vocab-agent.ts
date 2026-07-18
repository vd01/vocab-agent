/**
 * Vocab Agent Extension — Router + Delegated Tool Registration
 *
 * Refactored from the original 841-line monolith into:
 *   - This file: routing logic only (mode switching, system prompt injection)
 *   - tools/teacher-tools.ts: 12 Teacher tools via wrapTool()
 *   - tools/developer-tools.ts: 9 Developer tools via wrapTool()
 *
 * Using a single extension avoids event handler ordering issues
 * across multiple extensions. Tool registration is delegated to
 * focused modules that use the shared wrapTool() adapter.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTeacherTools } from "../tools/teacher-tools";
import { registerDeveloperTools } from "../tools/developer-tools";

export default function vocabAgentExtension(pi: ExtensionAPI) {
	// ═══════════════════════════════════════════════════════════════════════
	// DUAL AGENT ROUTING
	// ═══════════════════════════════════════════════════════════════════════

	pi.on("before_agent_start", async (event) => {
		// Read mode context from globalThis (bridged from Next.js runtime).
		// jiti and Turbopack load separate module instances, so AsyncLocalStorage
		// set in Next.js is invisible here. We use globalThis as the cross-boundary bridge.
		const GLOBAL_MODE_KEY = Symbol.for("vocab-agent:mode-context");
		const modeCtx = (globalThis as any)[GLOBAL_MODE_KEY] ?? {
			mode: "teach",
			modeSwitched: false,
			activeGroup: null,
		};
		const isDeveloper = modeCtx.mode === "develop";
		console.log(
			`[vocab-agent] before_agent_start: mode=${modeCtx.mode}, isDeveloper=${isDeveloper}`,
		);

		// ── Switch tool set ───────────────────────────────────────────────
		if (isDeveloper) {
			pi.setActiveTools([
				// pi built-in file tools (no bash — replaced by safe-ls)
				"read",
				"write",
				"edit",
				// pi-readseek tools
				"readSeek_read",
				"readSeek_edit",
				"readSeek_grep",
				"readSeek_search",
				"readSeek_refs",
				"readSeek_rename",
				"readSeek_hover",
				"readSeek_def",
				"readSeek_check",
				"readSeek_write",
				// vocab developer tools
				"create-command",
				"register-component",
				"unregister-component",
				"db-query",
				"save-lesson",
				"list-lessons",
				"merge-lessons",
				"test-command",
				"safe-ls",
			]);
		} else {
			pi.setActiveTools([
				// vocab teacher tools only
				"fsrs-review",
				"fsrs-rate",
				"vocab-lookup",
				"add-word",
				"batch-add-words",
				"import-by-tag",
				"extract-words",
				"dict-lookup",
				"vocab-stats",
				"pin-word",
				"unpin-word",
				"wordnet-lookup",
				"wiktionary-lookup",
				"mdx-lookup",
			]);
		}

		// ── Inject system prompt ──────────────────────────────────────────
		let systemPrompt = event.systemPrompt;

		if (isDeveloper) {
			try {
				const { buildDeveloperInstructions } = await import(
					"../../src/lib/ai/prompts/developer-system"
				);
				systemPrompt = buildDeveloperInstructions("", undefined);
			} catch (err) {
				console.error("[vocab-agent] Failed to build developer prompt:", err);
			}
		} else {
			try {
				const { buildWorldState } = await import(
					"../../src/lib/pipeline/world-state"
				);
				const { buildTeacherInstructions } = await import(
					"../../src/lib/ai/prompts/teacher-system"
				);
				const worldState = await buildWorldState();
				systemPrompt = buildTeacherInstructions(worldState);
			} catch (err) {
				console.error("[vocab-agent] Failed to build teacher prompt:", err);
			}
		}

		// ── Mode switch hint ──────────────────────────────────────────────
		if (modeCtx.modeSwitched) {
			systemPrompt += isDeveloper
				? "\n\n[模式切换提示] 用户刚刚切换到开发模式。你现在以系统开发者助手的身份工作，专注于代码开发和功能扩展。之前的对话可能来自教学模式，请忽略其中的教学上下文。"
				: "\n\n[模式切换提示] 用户刚刚切换到教学模式。你现在以英语教师的身份工作，专注于英语教学和词汇复习。之前的对话可能来自开发模式，请忽略其中的代码开发上下文。";
		}

		return { systemPrompt };
	});

	// ═══════════════════════════════════════════════════════════════════════
	// TOOL REGISTRATION — delegated to focused modules
	// ═══════════════════════════════════════════════════════════════════════

	registerTeacherTools(pi);
	registerDeveloperTools(pi);
}
