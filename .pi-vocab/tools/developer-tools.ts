/**
 * Developer Tools — registered via wrapTool() to eliminate boilerplate.
 *
 * Each tool's execute logic lives in src/lib/ai/tools/*.ts.
 * This module only defines the TypeBox parameter schema and metadata
 * needed by pi.registerTool(), then delegates execution via wrapTool().
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { wrapTool } from "../tools/wrap-tool";

const TOOL_MODULE = "../../src/lib/ai/tools";

export function registerDeveloperTools(pi: ExtensionAPI) {
	// ── create-command ───────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "create-command",
		label: "Create Command",
		description:
			"创建或更新一个 / 命令，一步完成命令注册和 UI 组件注册。代码必须先写入文件（用 readSeek_write），然后通过路径引用。toolCode 必须是纯 JavaScript async 函数表达式（不能有 TypeScript 类型注解）。沙盒注入: db, client, tables, dql, fsrs, args, console。返回值: { type: 'message', message: '...' } 或 { type: '<name>', ...data }。",
		promptSnippet: "注册新的斜杠命令",
		promptGuidelines: [
			"Use create-command after writing command code files to register them as slash commands.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "命令名称（不含 / 前缀）" }),
			description: Type.String({ description: "命令描述" }),
			toolCodePath: Type.String({
				description: "toolCode 文件路径（相对于项目根目录）",
			}),
			componentCodePath: Type.Optional(
				Type.String({ description: "组件代码文件路径" }),
			),
		}),
		toolModule: `${TOOL_MODULE}/create-command`,
		toolExport: "createCommandTool",
		summarizeResult: (r) => r.message ?? "命令注册完成",
	});

	// ── register-component ───────────────────────────────────────────────
	wrapTool({
		pi,
		name: "register-component",
		label: "Register Component",
		description:
			"注册新的 UI 组件到动态组件注册表。推荐使用 create-command 代替。组件必须包含 'use client' 和 export default。name 必须与命令名一致（不加 -panel 后缀）。",
		promptSnippet: "注册动态 UI 组件",
		parameters: Type.Object({
			name: Type.String({ description: "命令名称" }),
			code: Type.Optional(
				Type.String({ description: "简短的 React 组件代码" }),
			),
			codePath: Type.Optional(Type.String({ description: "组件代码文件路径" })),
		}),
		toolModule: `${TOOL_MODULE}/register-component`,
		toolExport: "registerComponentTool",
		summarizeResult: (r) => r.message ?? "组件注册完成",
	});

	// ── unregister-component ─────────────────────────────────────────────
	wrapTool({
		pi,
		name: "unregister-component",
		label: "Unregister Component",
		description:
			"删除命令及其 UI 组件。必须使用本工具（而非直接删除文件）。它会删除组件文件 + toolCode 文件 + 重写 component-registry.ts + 删除 DB 记录。name 必须与命令名一致。",
		promptSnippet: "删除动态 UI 组件",
		parameters: Type.Object({
			name: Type.String({ description: "命令名称" }),
		}),
		toolModule: `${TOOL_MODULE}/unregister-component`,
		toolExport: "unregisterComponentTool",
		summarizeResult: (r) => r.message ?? "组件删除完成",
	});

	// ── db-query ─────────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "db-query",
		label: "DB Query",
		description:
			"查询数据库。queryType: word-count(词库总量), review-history(复习记录), word-search(搜索单词), custom(自定义 SELECT SQL)。custom 模式仅支持 SELECT，不支持写操作。",
		promptSnippet: "查询词汇数据库",
		parameters: Type.Object({
			queryType: Type.String({ description: "查询类型" }),
			word: Type.Optional(Type.String({ description: "查询单词" })),
			limit: Type.Optional(Type.Number({ description: "返回数量限制" })),
			sql: Type.Optional(
				Type.String({ description: "自定义 SQL (仅 SELECT)" }),
			),
		}),
		toolModule: `${TOOL_MODULE}/db-query`,
		toolExport: "dbQueryTool",
		summarizeResult: (r) =>
			typeof r === "string" ? r.slice(0, 500) : "查询完成",
	});

	// ── save-lesson ──────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "save-lesson",
		label: "Save Lesson",
		description:
			"保存经验教训到知识库，供未来开发任务参考。相同标题自动更新（返回 type: 'updated'），不会重复创建。",
		promptSnippet: "保存开发经验教训",
		promptGuidelines: [
			"Use save-lesson when you discover a non-obvious pitfall, effective pattern, or useful tip during development.",
		],
		parameters: Type.Object({
			category: StringEnum(
				["pattern", "anti-pattern", "tip", "pitfall"] as const,
				{
					description:
						"经验类别: pattern=成功模式, anti-pattern=应避免的做法, tip=实用技巧, pitfall=常见陷阱",
				},
			),
			title: Type.String({
				description: "简短标题，如 '组件名必须与 type 匹配'",
			}),
			content: Type.String({ description: "详细描述，包含具体做法和原因" }),
			context: Type.Optional(
				Type.String({ description: "触发场景，如 '注册新命令时'" }),
			),
		}),
		toolModule: `${TOOL_MODULE}/save-lesson`,
		toolExport: "saveLessonTool",
		summarizeResult: (r) => r.message ?? "经验已保存",
	});

	// ── list-lessons ─────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "list-lessons",
		label: "List Lessons",
		description: "列出知识库中所有经验教训。",
		promptSnippet: "列出经验教训",
		parameters: Type.Object({}),
		toolModule: `${TOOL_MODULE}/list-lessons`,
		toolExport: "listLessonsTool",
		summarizeResult: (r) =>
			typeof r === "string" ? r.slice(0, 500) : "查询完成",
	});

	// ── merge-lessons ────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "merge-lessons",
		label: "Merge Lessons",
		description:
			"合并冗余的经验教训。先用 list-lessons 获取 ID，再调用本工具合并。合并后删除被合并的旧条目。",
		promptSnippet: "合并经验教训",
		promptGuidelines: [
			"Use merge-lessons when list-lessons reveals semantically duplicate or overlapping entries.",
		],
		parameters: Type.Object({
			keepId: Type.String({ description: "保留的教训 ID（合并后的主记录）" }),
			mergeIds: Type.Array(Type.String(), {
				description: "要合并删除的教训 ID 列表",
			}),
			mergedTitle: Type.String({ description: "合并后的标题" }),
			mergedContent: Type.String({
				description: "合并后的内容（综合各条精华，精炼表述）",
			}),
			mergedCategory: StringEnum(
				["pattern", "anti-pattern", "tip", "pitfall"] as const,
				{ description: "合并后的类别" },
			),
			mergedContext: Type.Optional(
				Type.String({ description: "合并后的触发场景" }),
			),
		}),
		toolModule: `${TOOL_MODULE}/merge-lessons`,
		toolExport: "mergeLessonsTool",
		summarizeResult: (r) => r.message ?? "合并完成",
	});

	// ── test-command ─────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "test-command",
		label: "Test Command",
		description:
			"测试已注册的 / 命令是否正常工作。返回 _testVerdict: pass/warn/fail。fail 时查看 _errorDetail 修复。",
		promptSnippet: "测试斜杠命令",
		promptGuidelines: [
			"Use test-command after create-command to verify the command works correctly.",
		],
		parameters: Type.Object({
			command: Type.String({
				description:
					"要测试的完整命令，如 'word-stats' 或 'prefix-search app'（不含 / 前缀）",
			}),
		}),
		toolModule: `${TOOL_MODULE}/test-command`,
		toolExport: "testCommandTool",
		summarizeResult: (r) => r.message ?? "测试完成",
	});

	// ── safe-ls ──────────────────────────────────────────────────────────
	pi.registerTool({
		name: "safe-ls",
		label: "List Directory",
		description:
			"列出目录内容。只能执行 ls 命令查看文件结构，不能执行其他 shell 命令。",
		promptSnippet: "查看目录结构",
		parameters: Type.Object({
			path: Type.Optional(
				Type.String({ description: "要列出的目录路径（默认为项目根目录）" }),
			),
		}),
		async execute(_toolCallId, params) {
			const dir = params.path || process.cwd();
			const { execSync } = await import("child_process");
			try {
				const output = execSync(`ls -la ${JSON.stringify(dir)}`, {
					encoding: "utf-8",
					timeout: 5000,
					cwd: process.cwd(),
				});
				return {
					content: [{ type: "text" as const, text: output }],
					details: null,
				};
			} catch (err: any) {
				return {
					content: [{ type: "text" as const, text: `Error: ${err.message}` }],
					details: null,
					isError: true,
				};
			}
		},
	});
}
