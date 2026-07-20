/**
 * Tool adapter — eliminates the repetitive import+wrap pattern in the
 * vocab-agent extension.
 *
 * Instead of each tool registration in the extension having:
 *   1. dynamic import of the tool module
 *   2. calling tool.execute() with a fake context
 *   3. wrapping the result into { content, details }
 *
 * This helper does all three steps in one call.
 *
 * Usage in vocab-agent.ts:
 *   wrapTool(pi, {
 *     name: "add-word",
 *     label: "Add Word",
 *     description: "添加单词到词库",
 *     toolModule: "../../src/lib/ai/tools/add-word",
 *     toolExport: "addWordTool",
 *     summarizeResult: (r, p) => r.type === 'added' ? `已添加 ${p.word}` : r.message,
 *   });
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { wordDebugger } from "../../src/lib/debug/word-debug";

interface WrapToolOptions {
	pi: ExtensionAPI;
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	/** TypeBox parameter schema (defined inline in extension) */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	parameters: any;
	/** Dynamic import path for the tool module */
	toolModule: string;
	/** Name of the tool export in the module */
	toolExport: string;
	/** Optional custom result summarizer */
	summarizeResult?: (result: any, params: Record<string, unknown>) => string;
}

/**
 * Register a tool with the pi extension using a shared execute wrapper.
 * The parameters schema is still defined in the extension (TypeBox),
 * but the execute logic delegates to the tool implementation file.
 */
export function wrapTool(options: WrapToolOptions) {
	const {
		pi,
		name,
		label,
		description,
		promptSnippet,
		promptGuidelines,
		parameters,
		toolModule,
		toolExport,
		summarizeResult,
	} = options;

	pi.registerTool({
		name,
		label,
		description,
		...(promptSnippet ? { promptSnippet } : {}),
		...(promptGuidelines ? { promptGuidelines } : {}),
		parameters,
		async execute(_toolCallId, params) {
			const mod = await import(toolModule);
			const tool = mod[toolExport];
			const result = await tool.execute(params, {
				toolCallId: "pi",
				messages: [],
				abortSignal: undefined,
			});

			const text = summarizeResult
				? summarizeResult(result, params as Record<string, unknown>)
				: defaultSummarize(result, params as Record<string, unknown>, name);

			// Debug: record the text sent to LLM for word-related tools
			const word = (params as Record<string, unknown>).word as string | undefined;
			if (word && wordDebugger.isTracking(word)) {
				wordDebugger.recordLLMInput(word, name, text);
			}

			return {
				content: [{ type: "text" as const, text }],
				details: result,
			};
		},
	});
}

function defaultSummarize(
	result: any,
	params: Record<string, unknown>,
	toolName: string,
): string {
	if (result?.message) return result.message;
	if (result?.type) {
		const typeMessages: Record<string, string> = {
			added: `已添加 ${params.word ?? ""}`,
			"already-exists": `${params.word ?? ""} 已在词库中`,
			found: `词库中找到 ${params.word ?? ""}`,
			"dict-found": `词典中找到 ${params.word ?? ""}`,
			"not-found": `未找到单词 ${params.word ?? ""}`,
			"due-words": `找到 ${result.words?.length ?? 0} 个待复习单词`,
			"no-due-words": "当前没有待复习的单词",
			"review-result": `评分完成，下次复习: ${result.scheduledDays} 天后`,
			"extracted-words": `提取出 ${result.words?.length ?? 0} 个生词`,
			"batch-added": result.message ?? "批量添加完成",
			stats: `词库统计: ${result.total ?? 0} 个单词`,
			pinned: result.message ?? "置顶操作完成",
			unpinned: result.message ?? "取消置顶完成",
		};
		return typeMessages[result.type] ?? `${toolName} 完成`;
	}
	return `${toolName} 完成`;
}
