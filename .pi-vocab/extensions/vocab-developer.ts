/**
 * Vocab Developer Extension — System development tools
 *
 * Registers 7 Developer Agent tools (file operations are handled by
 * pi built-in read/write/edit + pi-readseek).
 *
 * Tools:
 *   create-command, register-component, unregister-component,
 *   db-query, save-lesson, list-lessons, merge-lessons, test-command
 *
 * Note: file-read and file-list are NOT registered here because
 * pi's built-in read/ls and pi-readseek's readSeek_read/readSeek_grep
 * provide superior file operations. The old file-write/file-edit
 * tools (marker block guidance) are deleted entirely.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function vocabDeveloperExtension(pi: ExtensionAPI) {
	// ── Developer system prompt injection ─────────────────────────────────

	pi.on("before_agent_start", async (event, ctx) => {
		const { getCurrentModeContext } = await import(
			"@/app/api/chat/pi-route"
		);
		const modeCtx = getCurrentModeContext();
		if (modeCtx.mode !== "develop") return undefined;

		try {
			const { buildDeveloperInstructions } = await import(
				"@/lib/ai/prompts/developer-system"
			);
			const instructions = buildDeveloperInstructions("", undefined);
			return { systemPrompt: instructions };
		} catch (err) {
			console.error("[vocab-developer] Failed to inject prompt:", err);
			return undefined;
		}
	});

	// ── Tool: create-command ──────────────────────────────────────────────

	pi.registerTool({
		name: "create-command",
		label: "Create Command",
		description:
			"创建或更新一个 / 命令，一步完成命令注册和 UI 组件注册。代码必须先写入文件，然后通过路径引用。",
		promptSnippet: "注册新的斜杠命令",
		parameters: Type.Object({
			name: Type.String({ description: "命令名称（不含 / 前缀）" }),
			description: Type.String({ description: "命令描述" }),
			toolCodePath: Type.String({
				description: "toolCode 文件路径（相对于项目根目录）",
			}),
			componentCodePath: Type.Optional(
				Type.String({
					description: "组件代码文件路径（可选）",
				}),
			),
		}),
		async execute(toolCallId, params) {
			const { createCommandTool } = await import(
				"@/lib/ai/tools/create-command"
			);
			const result = await createCommandTool.execute!(
				{
					name: params.name,
					description: params.description,
					toolCodePath: params.toolCodePath,
					componentCodePath: params.componentCodePath,
				},
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: (result as any).message ?? "命令注册完成",
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: register-component ──────────────────────────────────────────

	pi.registerTool({
		name: "register-component",
		label: "Register Component",
		description:
			"注册新的 UI 组件到动态组件注册表。推荐使用 create-command 代替。",
		promptSnippet: "注册动态 UI 组件",
		parameters: Type.Object({
			name: Type.String({ description: "命令名称" }),
			code: Type.Optional(Type.String({ description: "简短的 React 组件代码" })),
			codePath: Type.Optional(
				Type.String({ description: "组件代码文件路径" }),
			),
		}),
		async execute(toolCallId, params) {
			const { registerComponentTool } = await import(
				"@/lib/ai/tools/register-component"
			);
			const result = await registerComponentTool.execute!(
				{ name: params.name, code: params.code, codePath: params.codePath },
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: (result as any).message ?? "组件注册完成",
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: unregister-component ─────────────────────────────────────────

	pi.registerTool({
		name: "unregister-component",
		label: "Unregister Component",
		description: "删除组件。必须使用本工具（而非直接删除文件）。",
		promptSnippet: "删除动态 UI 组件",
		parameters: Type.Object({
			name: Type.String({ description: "命令名称" }),
		}),
		async execute(toolCallId, params) {
			const { unregisterComponentTool } = await import(
				"@/lib/ai/tools/unregister-component"
			);
			const result = await unregisterComponentTool.execute!(
				{ name: params.name },
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: (result as any).message ?? "组件删除完成",
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: db-query ────────────────────────────────────────────────────

	pi.registerTool({
		name: "db-query",
		label: "DB Query",
		description:
			"查询数据库。queryType: word-count, review-history, word-search, custom",
		promptSnippet: "查询词汇数据库",
		parameters: Type.Object({
			queryType: Type.String({ description: "查询类型" }),
			word: Type.Optional(Type.String({ description: "查询单词" })),
			limit: Type.Optional(Type.Number({ description: "返回数量限制" })),
			sql: Type.Optional(Type.String({ description: "自定义 SQL (仅 SELECT)" })),
		}),
		async execute(toolCallId, params) {
			const { dbQueryTool } = await import("@/lib/ai/tools/db-query");
			const result = await dbQueryTool.execute!(
				{
					queryType: params.queryType,
					word: params.word,
					limit: params.limit,
					sql: params.sql,
				},
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: typeof result === "string" ? result.slice(0, 500) : "查询完成",
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: save-lesson ─────────────────────────────────────────────────

	pi.registerTool({
		name: "save-lesson",
		label: "Save Lesson",
		description: "保存经验教训。相同标题自动更新。",
		promptSnippet: "保存开发经验教训",
		parameters: Type.Object({
			title: Type.String({ description: "经验标题" }),
			content: Type.String({ description: "经验内容" }),
		}),
		async execute(toolCallId, params) {
			const { saveLessonTool } = await import("@/lib/ai/tools/save-lesson");
			const result = await saveLessonTool.execute!(
				{ title: params.title, content: params.content },
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: (result as any).message ?? "经验已保存",
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: list-lessons ────────────────────────────────────────────────

	pi.registerTool({
		name: "list-lessons",
		label: "List Lessons",
		description: "列出知识库中所有经验教训。",
		promptSnippet: "列出经验教训",
		parameters: Type.Object({}),
		async execute(toolCallId, params) {
			const { listLessonsTool } = await import("@/lib/ai/tools/list-lessons");
			const result = await listLessonsTool.execute!(
				{},
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: typeof result === "string" ? result.slice(0, 500) : "查询完成",
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: merge-lessons ───────────────────────────────────────────────

	pi.registerTool({
		name: "merge-lessons",
		label: "Merge Lessons",
		description: "合并冗余的经验教训。",
		promptSnippet: "合并经验教训",
		parameters: Type.Object({
			keepTitle: Type.String({ description: "保留的标题" }),
			removeTitles: Type.String({ description: "要合并的标题（逗号分隔）" }),
		}),
		async execute(toolCallId, params) {
			const { mergeLessonsTool } = await import(
				"@/lib/ai/tools/merge-lessons"
			);
			const result = await mergeLessonsTool.execute!(
				{
					keepTitle: params.keepTitle,
					removeTitles: params.removeTitles,
				},
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: (result as any).message ?? "合并完成",
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: test-command ────────────────────────────────────────────────

	pi.registerTool({
		name: "test-command",
		label: "Test Command",
		description: "测试已注册的 / 命令。",
		promptSnippet: "测试斜杠命令",
		parameters: Type.Object({
			name: Type.String({ description: "命令名称" }),
			args: Type.Optional(Type.String({ description: "命令参数" })),
		}),
		async execute(toolCallId, params) {
			const { testCommandTool } = await import(
				"@/lib/ai/tools/test-command"
			);
			const result = await testCommandTool.execute!(
				{ name: params.name, args: params.args },
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: (result as any).message ?? "测试完成",
					},
				],
				details: result,
			};
		},
	});
}
