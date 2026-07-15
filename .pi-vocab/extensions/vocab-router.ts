/**
 * Vocab Router Extension — Dual Agent routing
 *
 * Listens to before_agent_start and switches the active tool set
 * and system prompt based on the current mode (teach/develop).
 *
 * Mode context is set by the chat API route before calling session.prompt().
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function vocabRouterExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		// Read mode context set by the chat API route
		// Dynamic import to avoid circular deps — the route sets this via a shared module
		const { getCurrentModeContext } = await import(
			"@/app/api/chat/pi-route"
		);
		const modeCtx = getCurrentModeContext();
		const isDeveloper = modeCtx.mode === "develop";

		if (isDeveloper) {
			// Enable developer tools, disable teacher tools
			pi.setActiveTools({
				include: [
					// pi built-in file tools
					"read", "write", "edit", "bash",
					// pi-readseek tools
					"readSeek_read", "readSeek_edit", "readSeek_grep",
					"readSeek_search", "readSeek_refs", "readSeek_rename",
					"readSeek_hover", "readSeek_def", "readSeek_check", "readSeek_write",
					// vocab developer tools
					"create-command", "register-component", "unregister-component",
					"db-query", "save-lesson", "list-lessons", "merge-lessons",
					"test-command",
				],
				exclude: [
					// Disable teacher tools
					"fsrs-review", "fsrs-rate", "vocab-lookup", "add-word",
					"extract-words", "dict-lookup", "vocab-stats",
					"pin-word", "unpin-word", "group-manage",
				],
			});
		} else {
			// Enable teacher tools, disable developer tools
			pi.setActiveTools({
				include: [
					// vocab teacher tools
					"fsrs-review", "fsrs-rate", "vocab-lookup", "add-word",
					"extract-words", "dict-lookup", "vocab-stats",
					"pin-word", "unpin-word", "group-manage",
				],
				exclude: [
					// Disable pi built-in file tools (teacher doesn't write files)
					"read", "write", "edit", "bash",
					"readSeek_read", "readSeek_edit", "readSeek_grep",
					"readSeek_search", "readSeek_refs", "readSeek_rename",
					"readSeek_hover", "readSeek_def", "readSeek_check", "readSeek_write",
					// Disable developer tools
					"create-command", "register-component", "unregister-component",
					"db-query", "save-lesson", "list-lessons", "merge-lessons",
					"test-command",
				],
			});
		}

		// Mode switch hint
		if (modeCtx.modeSwitched) {
			const hint = isDeveloper
				? "\n\n[模式切换提示] 用户刚刚切换到开发模式。你现在以系统开发者助手的身份工作，专注于代码开发和功能扩展。之前的对话可能来自教学模式，请忽略其中的教学上下文。"
				: "\n\n[模式切换提示] 用户刚刚切换到教学模式。你现在以英语教师的身份工作，专注于英语教学和词汇复习。之前的对话可能来自开发模式，请忽略其中的代码开发上下文。";
			return { systemPrompt: event.systemPrompt + hint };
		}

		return undefined;
	});
}
