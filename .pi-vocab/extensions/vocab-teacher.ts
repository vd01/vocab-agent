/**
 * Vocab Teacher Extension — English teaching tools
 *
 * Registers 10 Teacher Agent tools and injects World State
 * into the system prompt before each agent turn.
 *
 * Tools:
 *   fsrs-review, fsrs-rate, vocab-lookup, add-word, extract-words,
 *   dict-lookup, vocab-stats, pin-word, unpin-word, group-manage
 *
 * Each tool returns:
 *   content: [{ type: "text", text: "..." }]  — concise text for LLM
 *   details: { uiType, ...data }              — structured UI data for frontend
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function vocabTeacherExtension(pi: ExtensionAPI) {
	// ── World State injection ─────────────────────────────────────────────

	pi.on("before_agent_start", async (event, ctx) => {
		// Only inject for teacher mode
		const { getCurrentModeContext } = await import(
			"@/app/api/chat/pi-route"
		);
		const modeCtx = getCurrentModeContext();
		if (modeCtx.mode !== "teach") return undefined;

		try {
			const { buildWorldState } = await import("@/lib/pipeline/world-state");
			const { buildTeacherInstructions } = await import(
				"@/lib/ai/prompts/teacher-system"
			);
			const worldState = await buildWorldState();
			const instructions = buildTeacherInstructions(worldState);

			// Replace system prompt with teacher instructions
			return { systemPrompt: instructions };
		} catch (err) {
			console.error("[vocab-teacher] Failed to inject World State:", err);
			return undefined;
		}
	});

	// ── Tool: fsrs-review ─────────────────────────────────────────────────

	pi.registerTool({
		name: "fsrs-review",
		label: "FSRS Review",
		description:
			"获取待复习的单词列表。支持 limit 和 group 参数。返回待复习单词、配额信息。",
		promptSnippet: "获取待复习单词列表",
		promptGuidelines: [
			"Use fsrs-review when the user wants to review vocabulary or practice flashcards.",
		],
		parameters: Type.Object({
			limit: Type.Optional(Type.Number({ description: "最多返回的单词数" })),
			group: Type.Optional(Type.String({ description: "按分组筛选" })),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { getDueWords } = await import("@/lib/fsrs/scheduler");
			const words = await getDueWords(params.limit, params.group);

			// Get queue info
			const { getProficiencyDistribution, getDailyStats } = await import(
				"@/lib/fsrs/scheduler"
			);
			const dist = getProficiencyDistribution();
			const daily = getDailyStats();

			return {
				content: [
					{
						type: "text" as const,
						text: `找到 ${words.length} 个待复习单词。`,
					},
				],
				details: {
					uiType: "due-words",
					words,
					queueInfo: {
						newCount: dist.new,
						learningCount: dist.learning,
						reviewCount: dist.review,
						dailyReviewed: daily.reviewed,
						dailyCorrectRate: daily.correctRate,
					},
				},
			};
		},
	});

	// ── Tool: fsrs-rate ───────────────────────────────────────────────────

	pi.registerTool({
		name: "fsrs-rate",
		label: "FSRS Rate",
		description: "记录复习评分。rating: 1=Again, 2=Hard, 3=Good, 4=Easy",
		promptSnippet: "提交单词复习评分",
		parameters: Type.Object({
			wordId: Type.String({ description: "单词ID" }),
			rating: Type.Number({ description: "评分 1-4" }),
		}),
		async execute(toolCallId, params) {
			const { processReview } = await import("@/lib/fsrs/scheduler");
			const result = await processReview(params.wordId, params.rating);

			return {
				content: [
					{
						type: "text" as const,
						text: `评分 ${params.rating}，下次复习: ${result.scheduledDays} 天后`,
					},
				],
				details: {
					uiType: "review-result",
					rating: params.rating,
					scheduledDays: result.scheduledDays,
				},
			};
		},
	});

	// ── Tool: vocab-lookup ────────────────────────────────────────────────

	pi.registerTool({
		name: "vocab-lookup",
		label: "Vocab Lookup",
		description:
			"查询单词含义。先查用户词库，再查词典。返回释义、音标、学习进度等。",
		promptSnippet: "查询单词含义和学习进度",
		parameters: Type.Object({
			word: Type.String({ description: "要查询的英文单词" }),
		}),
		async execute(toolCallId, params) {
			// Reuse the existing tool logic
			const { vocabLookupTool } = await import(
				"@/lib/ai/tools/vocab-lookup"
			);
			// Execute the AI SDK tool and extract the result
			const result = await vocabLookupTool.execute!(
				{ word: params.word },
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: result.type === "found"
							? `找到单词 ${params.word}`
							: result.type === "dict-found"
								? `词典中找到 ${params.word}（不在词库中）`
								: `未找到单词 ${params.word}`,
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: add-word ────────────────────────────────────────────────────

	pi.registerTool({
		name: "add-word",
		label: "Add Word",
		description: "添加单词到词库。自动检查重复、填充音标/释义/例句。",
		promptSnippet: "添加单词到用户词库",
		parameters: Type.Object({
			word: Type.String({ description: "英文单词" }),
			definition: Type.Optional(Type.String({ description: "自定义释义" })),
			group: Type.Optional(Type.String({ description: "添加到指定分组" })),
		}),
		async execute(toolCallId, params) {
			const { addWordTool } = await import("@/lib/ai/tools/add-word");
			const result = await addWordTool.execute!(
				{ word: params.word, definition: params.definition, group: params.group },
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: result.type === "added"
							? `已添加 ${params.word}`
							: result.type === "already-exists"
								? `${params.word} 已在词库中`
								: `添加失败`,
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: extract-words ───────────────────────────────────────────────

	pi.registerTool({
		name: "extract-words",
		label: "Extract Words",
		description: "从英文文本中提炼生词。自动过滤停用词和已学词汇。",
		promptSnippet: "从英文文本提炼生词",
		parameters: Type.Object({
			text: Type.String({ description: "英文文本" }),
			maxWords: Type.Optional(Type.Number({ description: "最多提取词数" })),
		}),
		async execute(toolCallId, params) {
			const { extractWordsTool } = await import(
				"@/lib/ai/tools/extract-words"
			);
			const result = await extractWordsTool.execute!(
				{ text: params.text, maxWords: params.maxWords },
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: `提炼出 ${(result as any).words?.length ?? 0} 个生词`,
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: dict-lookup ─────────────────────────────────────────────────

	pi.registerTool({
		name: "dict-lookup",
		label: "Dict Lookup",
		description: "查词典获取单词详细信息（释义、词形变化、词频等）。",
		promptSnippet: "查词典获取详细释义",
		parameters: Type.Object({
			word: Type.String({ description: "英文单词" }),
		}),
		async execute(toolCallId, params) {
			const { dictLookupTool } = await import("@/lib/ai/tools/dict-lookup");
			const result = await dictLookupTool.execute!(
				{ word: params.word },
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: result.type === "dict-found"
							? `词典中找到 ${params.word}`
							: `词典中未找到 ${params.word}`,
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: vocab-stats ─────────────────────────────────────────────────

	pi.registerTool({
		name: "vocab-stats",
		label: "Vocab Stats",
		description: "查询词库详细统计信息。",
		promptSnippet: "查询词库统计",
		parameters: Type.Object({}),
		async execute(toolCallId, params) {
			const { vocabStatsTool } = await import("@/lib/ai/tools/vocab-stats");
			const result = await vocabStatsTool.execute!(
				{},
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: `词库统计: ${(result as any).totalWords ?? 0} 个单词`,
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: pin-word ────────────────────────────────────────────────────

	pi.registerTool({
		name: "pin-word",
		label: "Pin Word",
		description: "置顶单词到侧边栏，方便重点记忆。",
		promptSnippet: "置顶单词到侧边栏",
		parameters: Type.Object({
			wordId: Type.String({ description: "单词ID" }),
			side: Type.Optional(
				Type.Union([Type.Literal("left"), Type.Literal("right")]),
			),
		}),
		async execute(toolCallId, params) {
			const { pinWordTool } = await import("@/lib/ai/tools/pin-word");
			const result = await pinWordTool.execute!(
				{ wordId: params.wordId, side: params.side },
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: (result as any).message ?? "置顶操作完成",
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: unpin-word ──────────────────────────────────────────────────

	pi.registerTool({
		name: "unpin-word",
		label: "Unpin Word",
		description: "取消置顶单词。",
		promptSnippet: "取消置顶单词",
		parameters: Type.Object({
			pinId: Type.String({ description: "置顶记录ID" }),
		}),
		async execute(toolCallId, params) {
			const { unpinWordTool } = await import("@/lib/ai/tools/pin-word");
			const result = await unpinWordTool.execute!(
				{ pinId: params.pinId },
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: (result as any).message ?? "取消置顶完成",
					},
				],
				details: result,
			};
		},
	});

	// ── Tool: group-manage ────────────────────────────────────────────────

	pi.registerTool({
		name: "group-manage",
		label: "Group Manage",
		description:
			"管理词汇分组。action: list/create/rename/delete/add-word/remove-word",
		promptSnippet: "管理词汇分组",
		parameters: Type.Object({
			action: Type.String({ description: "操作类型" }),
			name: Type.Optional(Type.String({ description: "分组名称" })),
			groupId: Type.Optional(Type.String({ description: "分组ID" })),
			wordId: Type.Optional(Type.String({ description: "单词ID" })),
			word: Type.Optional(Type.String({ description: "单词" })),
		}),
		async execute(toolCallId, params) {
			const { groupManageTool } = await import(
				"@/lib/ai/tools/group-manage"
			);
			const result = await groupManageTool.execute!(
				{
					action: params.action,
					name: params.name,
					groupId: params.groupId,
					wordId: params.wordId,
					word: params.word,
				},
				{ toolCallId, messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: (result as any).message ?? "分组操作完成",
					},
				],
				details: result,
			};
		},
	});
}
