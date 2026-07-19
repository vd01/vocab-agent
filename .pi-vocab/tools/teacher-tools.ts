/**
 * Teacher Tools — registered via wrapTool() to eliminate boilerplate.
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

export function registerTeacherTools(pi: ExtensionAPI) {
	// ── fsrs-review ──────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "fsrs-review",
		label: "FSRS Review",
		description:
			"获取待复习的单词列表，用于 FSRS 间隔重复复习。可指定分组名只复习该分组的单词。",
		promptSnippet: "获取待复习单词列表",
		promptGuidelines: [
			"Use fsrs-review when the user wants to review vocabulary or practice flashcards.",
		],
		parameters: Type.Object({
			limit: Type.Optional(
				Type.Number({ description: "获取的单词数量，默认 5" }),
			),
			group: Type.Optional(
				Type.String({ description: "分组名称，如 四级、考研" }),
			),
		}),
		toolModule: `${TOOL_MODULE}/fsrs-review`,
		toolExport: "fsrsReviewTool",
		summarizeResult: (r) =>
			r.type === "no-due-words"
				? r.message
				: `找到 ${r.words?.length ?? 0} 个待复习单词`,
	});

	// ── fsrs-rate ────────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "fsrs-rate",
		label: "FSRS Rate",
		description:
			"对单词进行 FSRS 评分，更新复习调度。rating: 1=Again, 2=Hard, 3=Good, 4=Easy",
		promptSnippet: "提交单词复习评分",
		promptGuidelines: [
			"Use fsrs-rate after the user rates a word during a review session.",
		],
		parameters: Type.Object({
			wordId: Type.String({ description: "单词 ID" }),
			rating: Type.Number({ description: "评分 1-4" }),
		}),
		toolModule: `${TOOL_MODULE}/fsrs-review`,
		toolExport: "fsrsRateTool",
		summarizeResult: (r) => `评分完成，下次复习: ${r.scheduledDays} 天后`,
	});

	// ── vocab-lookup ─────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "vocab-lookup",
		label: "Vocab Lookup",
		description:
			"查询单词详情。先查用户词库，未找到则自动查词典，返回音标、释义、例句等。",
		promptSnippet: "查询单词含义和学习进度",
		promptGuidelines: [
			"Use vocab-lookup when the user asks about a word's meaning, pronunciation, or learning progress.",
		],
		parameters: Type.Object({
			word: Type.String({ description: "要查询的单词" }),
		}),
		toolModule: `${TOOL_MODULE}/vocab-lookup`,
		toolExport: "vocabLookupTool",
		summarizeResult: (r, p) =>
			r.type === "found"
				? `词库中找到 ${p.word}`
				: r.type === "dict-found"
					? `词典中找到 ${p.word}（不在词库中）`
					: `未找到单词 ${p.word}`,
	});

	// ── add-word ─────────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "add-word",
		label: "Add Word",
		description:
			"添加新单词到词库，并初始化 FSRS 复习卡片。只需提供 word，音标、释义、例句会自动从词典填充。",
		promptSnippet: "添加单词到用户词库",
		promptGuidelines: [
			"Use add-word when the user wants to add a new word to their vocabulary.",
		],
		parameters: Type.Object({
			word: Type.String({ description: "英语单词" }),
			definition: Type.Optional(Type.String({ description: "自定义释义" })),
			group: Type.Optional(Type.String({ description: "添加到指定分组" })),
		}),
		toolModule: `${TOOL_MODULE}/add-word`,
		toolExport: "addWordTool",
		summarizeResult: (r, p) =>
			r.type === "added"
				? `已添加 ${p.word}`
				: r.type === "already-exists"
					? `${p.word} 已在词库中`
					: (r.message ?? "添加失败"),
	});

	// ── batch-add-words ──────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "batch-add-words",
		label: "Batch Add Words",
		description:
			"批量添加多个单词到词库。比逐个调用 add-word 更高效，避免并发问题和 API 限流。只需提供单词列表，音标、释义等会自动从 ECDICT 离线词典填充。",
		promptSnippet: "批量添加多个单词到词库",
		promptGuidelines: [
			"Use batch-add-words when the user wants to add multiple words at once, especially after extract-words returns a list of new words.",
			"Prefer batch-add-words over calling add-word multiple times to avoid rate limiting and concurrency issues.",
		],
		parameters: Type.Object({
			words: Type.Array(Type.String(), { description: "要添加的英语单词列表" }),
			group: Type.Optional(
				Type.String({ description: "添加到指定分组（分组名），默认日常" }),
			),
		}),
		toolModule: `${TOOL_MODULE}/batch-add-words`,
		toolExport: "batchAddWordsTool",
		summarizeResult: (r) => r.message ?? "批量添加完成",
	});

	// ── extract-words ────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "extract-words",
		label: "Extract Words",
		description:
			"从英文文本中提取用户词库中不存在的生词，返回每个词的释义、音标、考试标签、Collins星级。",
		promptSnippet: "从英文文本提取生词",
		promptGuidelines: [
			"Use extract-words when the user shares English text and wants to find unfamiliar words.",
		],
		parameters: Type.Object({
			text: Type.String({ description: "要分析的英文文本" }),
			maxWords: Type.Optional(
				Type.Number({ description: "最多返回的生词数，默认 15" }),
			),
			group: Type.Optional(Type.String({ description: "建议添加到的分组名" })),
		}),
		toolModule: `${TOOL_MODULE}/extract-words`,
		toolExport: "extractWordsTool",
		summarizeResult: (r) =>
			r.type === "extracted-words"
				? `提取出 ${r.words?.length ?? 0} 个生词（你已认识 ${r.knownCount} 个词）`
				: (r.message ?? "未找到生词"),
	});

	// ── dict-lookup ──────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "dict-lookup",
		label: "Dict Lookup",
		description:
			"查词典获取单词的详细信息（音标、中英文释义、例句、同义词、词频、考试标签等）。不涉及用户词库。",
		promptSnippet: "查词典获取详细释义",
		promptGuidelines: [
			"Use dict-lookup when you need detailed dictionary information without checking the user's vocab library.",
		],
		parameters: Type.Object({
			word: Type.String({ description: "要查询的单词" }),
		}),
		toolModule: `${TOOL_MODULE}/dict-lookup`,
		toolExport: "dictLookupTool",
		summarizeResult: (r, p) =>
			r.type === "dict-found"
				? `词典中找到 ${p.word}`
				: `词典中未找到 ${p.word}`,
	});

	// ── wordnet-lookup ───────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "wordnet-lookup",
		label: "WordNet Lookup",
		description:
			"查 WordNet 获取单词的语义分类（synsets）、上下位关系（hypernyms/hyponyms）和词形变化。用于词义层次、同义辨析、词汇扩展。",
		promptSnippet: "查 WordNet 语义关系",
		promptGuidelines: [
			"Use wordnet-lookup when the user asks about word senses, semantic relations (hypernyms/hyponyms), or wants to explore word families.",
		],
		parameters: Type.Object({
			word: Type.String({ description: "要查询的单词" }),
		}),
		toolModule: `${TOOL_MODULE}/wordnet-lookup`,
		toolExport: "wordnetLookupTool",
		summarizeResult: (r, p) =>
			r.type === "wordnet-found"
				? `WordNet 中找到 ${p.word}（${r.synsetCount} 个 synset）`
				: `WordNet 中未找到 ${p.word}`,
	});

	// ── wiktionary-lookup ────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "wiktionary-lookup",
		label: "Wiktionary Lookup",
		description:
			"查 Wiktionary 获取详细词源（etymology）、词形变化表（forms）、多地区发音（IPA）和释义。",
		promptSnippet: "查 Wiktionary 词源和变位",
		promptGuidelines: [
			"Use wiktionary-lookup when the user asks about word origins (etymology), inflectional forms (conjugations/declensions), or detailed pronunciation.",
		],
		parameters: Type.Object({
			word: Type.String({ description: "要查询的单词" }),
		}),
		toolModule: `${TOOL_MODULE}/wiktionary-lookup`,
		toolExport: "wiktionaryLookupTool",
		summarizeResult: (r, p) =>
			r.type === "wiktionary-found"
				? `Wiktionary 中找到 ${p.word}`
				: `Wiktionary 中未找到 ${p.word}`,
	});


	// ── mdx-lookup ──────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "mdx-lookup",
		label: "MDX Lookup",
		description:
			"查用户安装的 MDX 词典（新牛津英汉双解 oald、朗文当代英汉双解 ldoce、韦氏高阶 merriam），获取完整权威释义。",
		promptSnippet: "查 MDX 权威词典释义",
		promptGuidelines: [
			"Use mdx-lookup when the user needs authoritative dictionary definitions from their installed MDX files (OALD, LDOCE, etc.).",
		],
		parameters: Type.Object({
			word: Type.String({ description: "要查询的单词" }),
			dict: Type.Optional(Type.String({ description: "指定词典 ID（oald / ldoce / merriam），留空查所有" })),
		}),
		toolModule: `${TOOL_MODULE}/mdx-lookup`,
		toolExport: "mdxLookupTool",
		summarizeResult: (r, p) => {
			if (r.type !== "mdx-found") return `MDX 词典中未找到 ${p.word}`;
			const lines = r.entries.map(
				(e: { dict: string; text: string }) => `[${e.dict}] ${e.text.slice(0, 300)}`,
			);
			return lines.join('\n');
		},
	});
	// ── vocab-stats ──────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "vocab-stats",
		label: "Vocab Stats",
		description:
			"查询用户词库的详细统计信息，包括总量、考试标签分布、熟练度、学习天数等。",
		promptSnippet: "查询词库统计",
		promptGuidelines: [
			"Use vocab-stats when the user asks about their learning progress or vocabulary statistics.",
		],
		parameters: Type.Object({
			detail: Type.Optional(Type.Boolean({ description: "是否显示详细信息" })),
		}),
		toolModule: `${TOOL_MODULE}/vocab-stats`,
		toolExport: "vocabStatsTool",
		summarizeResult: (r) =>
			`词库统计: ${r.total ?? 0} 个单词，连续学习 ${r.streakDays ?? 0} 天`,
	});

	// ── pin-word ─────────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "pin-word",
		label: "Pin Word",
		description:
			"将单词置顶到侧边栏，方便用户随时查看和复习。如果单词不在词库中，会自动添加。",
		promptSnippet: "置顶单词到侧边栏",
		promptGuidelines: [
			"Use pin-word when the user wants to pin a word to the sidebar for quick reference.",
		],
		parameters: Type.Object({
			wordId: Type.Optional(Type.String({ description: "单词 ID" })),
			word: Type.Optional(Type.String({ description: "单词文本" })),
			side: Type.Optional(StringEnum(["left", "right"] as const)),
		}),
		toolModule: `${TOOL_MODULE}/pin-word`,
		toolExport: "pinWordTool",
		summarizeResult: (r) => r.message ?? "置顶操作完成",
	});

	// ── unpin-word ───────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "unpin-word",
		label: "Unpin Word",
		description: "取消单词的置顶状态，从侧边栏移除。",
		promptSnippet: "取消置顶单词",
		promptGuidelines: [
			"Use unpin-word when the user wants to remove a pinned word from the sidebar.",
		],
		parameters: Type.Object({
			pinId: Type.String({ description: "置顶记录 ID" }),
		}),
		toolModule: `${TOOL_MODULE}/pin-word`,
		toolExport: "unpinWordTool",
		summarizeResult: (r) => r.message ?? "取消置顶完成",
	});

	// ── import-by-tag ────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "import-by-tag",
		label: "Import by Tag",
		description:
			"从 ECDICT 词典中按考试标签筛选高频单词并批量导入到词库。支持 cet4、cet6、gre、toefl、ielts 等标签，按词频排序选取最高频的词。可排除低级别词（如导入六级时排除四级词）。",
		promptSnippet: "按考试标签批量导入高频词",
		promptGuidelines: [
			"Use import-by-tag when the user wants to import a batch of high-frequency words for a specific exam level (e.g., CET-6, GRE, TOEFL, IELTS).",
			"This tool queries ECDICT by tag and sorts by frequency, so it can find the most common words for any exam level.",
			"Set preview=true first if the user wants to see the word list before importing.",
		],
		parameters: Type.Object({
			tag: Type.String({
				description:
					"考试标签：cet4(四级)、cet6(六级)、gre、toefl(托福)、ielts(雅思)",
			}),
			limit: Type.Optional(
				Type.Number({ description: "导入数量，默认 100，最大 500" }),
			),
			group: Type.Optional(
				Type.String({ description: "导入到指定分组名，必须已存在，默认日常" }),
			),
			excludeLowerTags: Type.Optional(
				Type.Boolean({
					description: "排除低级别词（如 cet6 排除 cet4），默认 true",
				}),
			),
			preview: Type.Optional(
				Type.Boolean({ description: "仅预览不导入，默认 false" }),
			),
		}),
		toolModule: `${TOOL_MODULE}/import-by-tag`,
		toolExport: "importByTagTool",
		summarizeResult: (r) => r.message ?? "导入操作完成",
	});

	// ── group-manage ─────────────────────────────────────────────────────
	wrapTool({
		pi,
		name: "group-manage",
		label: "Group Manage",
		description:
			"管理单词分组。支持创建、列出、重命名、删除分组，以及添加/移除分组中的单词。",
		promptSnippet: "管理词汇分组",
		promptGuidelines: [
			"Use group-manage when the user wants to organize words into groups or manage existing groups.",
		],
		parameters: Type.Object({
			action: StringEnum(
				[
					"list",
					"create",
					"rename",
					"delete",
					"add-word",
					"remove-word",
				] as const,
				{ description: "操作类型" },
			),
			name: Type.Optional(Type.String({ description: "分组名称" })),
			groupId: Type.Optional(Type.String({ description: "分组 ID" })),
			wordId: Type.Optional(Type.String({ description: "单词 ID" })),
			word: Type.Optional(Type.String({ description: "单词" })),
		}),
		toolModule: `${TOOL_MODULE}/group-manage`,
		toolExport: "groupManageTool",
		summarizeResult: (r) => r.message ?? "分组操作完成",
	});
}
