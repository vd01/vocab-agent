/**
 * Vocab Agent Extension — Unified Teacher + Developer + Router
 *
 * A single extension that handles:
 *   1. Dual Agent routing (Teacher/Developer mode switching)
 *   2. Teacher tools (10 tools for English learning)
 *   3. Developer tools (8 tools for system development)
 *   4. World State injection into system prompt
 *
 * Using a single extension avoids event handler ordering issues
 * across multiple extensions.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

export default function vocabAgentExtension(pi: ExtensionAPI) {
	// ═══════════════════════════════════════════════════════════════════════
	// DUAL AGENT ROUTING
	// ═══════════════════════════════════════════════════════════════════════

	pi.on("before_agent_start", async (event) => {
		// Read mode context set by the chat API route
		try {
			const { getCurrentModeContext } = await import(
				"../../src/app/api/chat/route"
			);
			const modeCtx = getCurrentModeContext();
			const isDeveloper = modeCtx.mode === "develop";
			console.log(`[vocab-agent] before_agent_start: mode=${modeCtx.mode}, isDeveloper=${isDeveloper}`);

		// ── Switch tool set ───────────────────────────────────────────────
		if (isDeveloper) {
			pi.setActiveTools([
				// pi built-in file tools (no bash — replaced by safe-ls)
				"read", "write", "edit",
				// pi-readseek tools
				"readSeek_read", "readSeek_edit", "readSeek_grep",
				"readSeek_search", "readSeek_refs", "readSeek_rename",
				"readSeek_hover", "readSeek_def", "readSeek_check", "readSeek_write",
				// vocab developer tools
				"create-command", "register-component", "unregister-component",
				"db-query", "save-lesson", "list-lessons", "merge-lessons",
				"test-command", "safe-ls",
			]);
		} else {
			pi.setActiveTools([
				// vocab teacher tools only
				"fsrs-review", "fsrs-rate", "vocab-lookup", "add-word",
				"batch-add-words", "extract-words", "dict-lookup", "vocab-stats",
				"pin-word", "unpin-word", "group-manage",
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
				const { buildWorldState } = await import("../../src/lib/pipeline/world-state");
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
		} catch (err) {
			console.error("[vocab-agent] before_agent_start error:", err);
			return {};
		}
	});

	// ═══════════════════════════════════════════════════════════════════════
	// TEACHER TOOLS (10)
	// ═══════════════════════════════════════════════════════════════════════

	// ── fsrs-review ──────────────────────────────────────────────────────

	pi.registerTool({
		name: "fsrs-review",
		label: "FSRS Review",
		description:
			"获取待复习的单词列表，用于 FSRS 间隔重复复习。可指定分组名只复习该分组的单词。",
		promptSnippet: "获取待复习单词列表",
		promptGuidelines: [
			"Use fsrs-review when the user wants to review vocabulary or practice flashcards.",
		],
		parameters: Type.Object({
			limit: Type.Optional(Type.Number({ description: "获取的单词数量，默认 5" })),
			group: Type.Optional(Type.String({ description: "分组名称，如 四级、考研" })),
		}),
		async execute(_toolCallId, params) {
			const { fsrsReviewTool } = await import("../../src/lib/ai/tools/fsrs-review");
			const result = await fsrsReviewTool.execute!(
				{ limit: params.limit, group: params.group },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: (result as any).type === "no-due-words"
							? (result as any).message
							: `找到 ${(result as any).words?.length ?? 0} 个待复习单词`,
					},
				],
				details: result,
			};
		},
	});

	// ── fsrs-rate ────────────────────────────────────────────────────────

	pi.registerTool({
		name: "fsrs-rate",
		label: "FSRS Rate",
		description: "对单词进行 FSRS 评分，更新复习调度。rating: 1=Again, 2=Hard, 3=Good, 4=Easy",
		promptSnippet: "提交单词复习评分",
		promptGuidelines: [
			"Use fsrs-rate after the user rates a word during a review session.",
		],
		parameters: Type.Object({
			wordId: Type.String({ description: "单词 ID" }),
			rating: Type.Number({ description: "评分 1-4" }),
		}),
		async execute(_toolCallId, params) {
			const { fsrsRateTool } = await import("../../src/lib/ai/tools/fsrs-review");
			const result = await fsrsRateTool.execute!(
				{ wordId: params.wordId, rating: params.rating },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: `评分 ${params.rating}，下次复习: ${(result as any).scheduledDays} 天后`,
					},
				],
				details: result,
			};
		},
	});

	// ── vocab-lookup ─────────────────────────────────────────────────────

	pi.registerTool({
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
		async execute(_toolCallId, params) {
			const { vocabLookupTool } = await import("../../src/lib/ai/tools/vocab-lookup");
			const result = await vocabLookupTool.execute!(
				{ word: params.word },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			const r = result as any;
			return {
				content: [
					{
						type: "text" as const,
						text: r.type === "found"
							? `词库中找到 ${params.word}`
							: r.type === "dict-found"
								? `词典中找到 ${params.word}（不在词库中）`
								: `未找到单词 ${params.word}`,
					},
				],
				details: result,
			};
		},
	});

	// ── add-word ─────────────────────────────────────────────────────────

	pi.registerTool({
		name: "add-word",
		label: "Add Word",
		description: "添加新单词到词库，并初始化 FSRS 复习卡片。只需提供 word，音标、释义、例句会自动从词典填充。",
		promptSnippet: "添加单词到用户词库",
		promptGuidelines: [
			"Use add-word when the user wants to add a new word to their vocabulary.",
		],
		parameters: Type.Object({
			word: Type.String({ description: "英语单词" }),
			definition: Type.Optional(Type.String({ description: "自定义释义" })),
			group: Type.Optional(Type.String({ description: "添加到指定分组" })),
		}),
		async execute(_toolCallId, params) {
			const { addWordTool } = await import("../../src/lib/ai/tools/add-word");
			const result = await addWordTool.execute!(
				{ word: params.word, definition: params.definition, group: params.group },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			const r = result as any;
			return {
				content: [
					{
						type: "text" as const,
						text: r.type === "added"
							? `已添加 ${params.word}`
							: r.type === "already-exists"
								? `${params.word} 已在词库中`
								: r.message ?? "添加失败",
					},
				],
				details: result,
			};
		},
	});

	// ── batch-add-words ───────────────────────────────────────────────

		pi.registerTool({
			name: "batch-add-words",
			label: "Batch Add Words",
			description: "批量添加多个单词到词库。比逐个调用 add-word 更高效，避免并发问题和 API 限流。只需提供单词列表，音标、释义等会自动从 ECDICT 离线词典填充。",
			promptSnippet: "批量添加多个单词到词库",
			promptGuidelines: [
				"Use batch-add-words when the user wants to add multiple words at once, especially after extract-words returns a list of new words.",
				"Prefer batch-add-words over calling add-word multiple times to avoid rate limiting and concurrency issues.",
			],
			parameters: Type.Object({
				words: Type.Array(Type.String(), { description: "要添加的英语单词列表" }),
				group: Type.Optional(Type.String({ description: "添加到指定分组（分组名），默认日常" })),
			}),
			async execute(_toolCallId, params) {
				const { batchAddWordsTool } = await import("../../src/lib/ai/tools/batch-add-words");
				const result = await batchAddWordsTool.execute!(
					{ words: params.words, group: params.group },
					{ toolCallId: "pi", messages: [], abortSignal: undefined },
				);

				const r = result as any;
				return {
					content: [
						{
							type: "text" as const,
							text: r.message ?? "批量添加完成",
						},
					],
					details: result,
				};
			},
		});

	// ── extract-words ────────────────────────────────────────────────────

	pi.registerTool({
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
			maxWords: Type.Optional(Type.Number({ description: "最多返回的生词数，默认 15" })),
			group: Type.Optional(Type.String({ description: "建议添加到的分组名" })),
		}),
		async execute(_toolCallId, params) {
			const { extractWordsTool } = await import("../../src/lib/ai/tools/extract-words");
			const result = await extractWordsTool.execute!(
				{ text: params.text, maxWords: params.maxWords, group: params.group },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			const r = result as any;
			return {
				content: [
					{
						type: "text" as const,
						text: r.type === "extracted-words"
							? `提取出 ${r.words?.length ?? 0} 个生词（你已认识 ${r.knownCount} 个词）`
							: r.message ?? "未找到生词",
					},
				],
				details: result,
			};
		},
	});

	// ── dict-lookup ──────────────────────────────────────────────────────

	pi.registerTool({
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
		async execute(_toolCallId, params) {
			const { dictLookupTool } = await import("../../src/lib/ai/tools/dict-lookup");
			const result = await dictLookupTool.execute!(
				{ word: params.word },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			const r = result as any;
			return {
				content: [
					{
						type: "text" as const,
						text: r.type === "dict-found"
							? `词典中找到 ${params.word}`
							: `词典中未找到 ${params.word}`,
					},
				],
				details: result,
			};
		},
	});

	// ── vocab-stats ──────────────────────────────────────────────────────

	pi.registerTool({
		name: "vocab-stats",
		label: "Vocab Stats",
		description: "查询用户词库的详细统计信息，包括总量、考试标签分布、熟练度、学习天数等。",
		promptSnippet: "查询词库统计",
		promptGuidelines: [
			"Use vocab-stats when the user asks about their learning progress or vocabulary statistics.",
		],
		parameters: Type.Object({
			detail: Type.Optional(Type.Boolean({ description: "是否显示详细信息" })),
		}),
		async execute(_toolCallId, params) {
			const { vocabStatsTool } = await import("../../src/lib/ai/tools/vocab-stats");
			const result = await vocabStatsTool.execute!(
				{ detail: params.detail },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			const r = result as any;
			return {
				content: [
					{
						type: "text" as const,
						text: `词库统计: ${r.total ?? 0} 个单词，连续学习 ${r.streakDays ?? 0} 天`,
					},
				],
				details: result,
			};
		},
	});

	// ── pin-word ─────────────────────────────────────────────────────────

	pi.registerTool({
		name: "pin-word",
		label: "Pin Word",
		description: "将单词置顶到侧边栏，方便用户随时查看和复习。如果单词不在词库中，会自动添加。",
		promptSnippet: "置顶单词到侧边栏",
		promptGuidelines: [
			"Use pin-word when the user wants to pin a word to the sidebar for quick reference.",
		],
		parameters: Type.Object({
			wordId: Type.Optional(Type.String({ description: "单词 ID" })),
			word: Type.Optional(Type.String({ description: "单词文本" })),
			side: Type.Optional(StringEnum(["left", "right"] as const)),
		}),
		async execute(_toolCallId, params) {
			const { pinWordTool } = await import("../../src/lib/ai/tools/pin-word");
			const result = await pinWordTool.execute!(
				{ wordId: params.wordId, word: params.word, side: params.side },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			const r = result as any;
			return {
				content: [
					{
						type: "text" as const,
						text: r.message ?? "置顶操作完成",
					},
				],
				details: result,
			};
		},
	});

	// ── unpin-word ───────────────────────────────────────────────────────

	pi.registerTool({
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
		async execute(_toolCallId, params) {
			const { unpinWordTool } = await import("../../src/lib/ai/tools/pin-word");
			const result = await unpinWordTool.execute!(
				{ pinId: params.pinId },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			const r = result as any;
			return {
				content: [
					{
						type: "text" as const,
						text: r.message ?? "取消置顶完成",
					},
				],
				details: result,
			};
		},
	});

	// ── group-manage ─────────────────────────────────────────────────────

	pi.registerTool({
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
				["list", "create", "rename", "delete", "add-word", "remove-word"] as const,
				{ description: "操作类型" },
			),
			name: Type.Optional(Type.String({ description: "分组名称" })),
			groupId: Type.Optional(Type.String({ description: "分组 ID" })),
			wordId: Type.Optional(Type.String({ description: "单词 ID" })),
			word: Type.Optional(Type.String({ description: "单词" })),
		}),
		async execute(_toolCallId, params) {
			const { groupManageTool } = await import("../../src/lib/ai/tools/group-manage");
			const result = await groupManageTool.execute!(
				{
					action: params.action,
					name: params.name,
					groupId: params.groupId,
					wordId: params.wordId,
					word: params.word,
				},
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			const r = result as any;
			return {
				content: [
					{
						type: "text" as const,
						text: r.message ?? "分组操作完成",
					},
				],
				details: result,
			};
		},
	});

	// ═══════════════════════════════════════════════════════════════════════
	// DEVELOPER TOOLS (8)
	// File operations use pi built-in read/write/edit + pi-readseek
	// ═══════════════════════════════════════════════════════════════════════

	// ── create-command ───────────────────────────────────────────────────

	pi.registerTool({
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
			toolCodePath: Type.String({ description: "toolCode 文件路径（相对于项目根目录）" }),
			componentCodePath: Type.Optional(Type.String({ description: "组件代码文件路径" })),
		}),
		async execute(_toolCallId, params) {
			const { createCommandTool } = await import("../../src/lib/ai/tools/create-command");
			const result = await createCommandTool.execute!(
				{
					name: params.name,
					description: params.description,
					toolCodePath: params.toolCodePath,
					componentCodePath: params.componentCodePath,
				},
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			return {
				content: [{ type: "text" as const, text: (result as any).message ?? "命令注册完成" }],
				details: result,
			};
		},
	});

	// ── register-component ───────────────────────────────────────────────

	pi.registerTool({
		name: "register-component",
		label: "Register Component",
		description:
			"注册新的 UI 组件到动态组件注册表。推荐使用 create-command 代替。组件必须包含 'use client' 和 export default。name 必须与命令名一致（不加 -panel 后缀）。",
		promptSnippet: "注册动态 UI 组件",
		parameters: Type.Object({
			name: Type.String({ description: "命令名称" }),
			code: Type.Optional(Type.String({ description: "简短的 React 组件代码" })),
			codePath: Type.Optional(Type.String({ description: "组件代码文件路径" })),
		}),
		async execute(_toolCallId, params) {
			const { registerComponentTool } = await import("../../src/lib/ai/tools/register-component");
			const result = await registerComponentTool.execute!(
				{ name: params.name, code: params.code, codePath: params.codePath },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			return {
				content: [{ type: "text" as const, text: (result as any).message ?? "组件注册完成" }],
				details: result,
			};
		},
	});

	// ── unregister-component ─────────────────────────────────────────────

	pi.registerTool({
		name: "unregister-component",
		label: "Unregister Component",
		description: "删除命令及其 UI 组件。必须使用本工具（而非直接删除文件）。它会删除组件文件 + toolCode 文件 + 重写 component-registry.ts + 删除 DB 记录。name 必须与命令名一致。",
		promptSnippet: "删除动态 UI 组件",
		parameters: Type.Object({
			name: Type.String({ description: "命令名称" }),
		}),
		async execute(_toolCallId, params) {
			const { unregisterComponentTool } = await import("../../src/lib/ai/tools/unregister-component");
			const result = await unregisterComponentTool.execute!(
				{ name: params.name },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			return {
				content: [{ type: "text" as const, text: (result as any).message ?? "组件删除完成" }],
				details: result,
			};
		},
	});

	// ── db-query ─────────────────────────────────────────────────────────

	pi.registerTool({
		name: "db-query",
		label: "DB Query",
		description:
			"查询数据库。queryType: word-count(词库总量), review-history(复习记录), word-search(搜索单词), custom(自定义 SELECT SQL)。custom 模式仅支持 SELECT，不支持写操作。",
		promptSnippet: "查询词汇数据库",
		parameters: Type.Object({
			queryType: Type.String({ description: "查询类型" }),
			word: Type.Optional(Type.String({ description: "查询单词" })),
			limit: Type.Optional(Type.Number({ description: "返回数量限制" })),
			sql: Type.Optional(Type.String({ description: "自定义 SQL (仅 SELECT)" })),
		}),
		async execute(_toolCallId, params) {
			const { dbQueryTool } = await import("../../src/lib/ai/tools/db-query");
			const result = await dbQueryTool.execute!(
				{
					queryType: params.queryType,
					word: params.word,
					limit: params.limit,
					sql: params.sql,
				},
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
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

	// ── save-lesson ──────────────────────────────────────────────────────

	pi.registerTool({
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
				{ description: "经验类别: pattern=成功模式, anti-pattern=应避免的做法, tip=实用技巧, pitfall=常见陷阱" },
			),
			title: Type.String({ description: "简短标题，如 '组件名必须与 type 匹配'" }),
			content: Type.String({ description: "详细描述，包含具体做法和原因" }),
			context: Type.Optional(Type.String({ description: "触发场景，如 '注册新命令时'" })),
		}),
		async execute(_toolCallId, params) {
			const { saveLessonTool } = await import("../../src/lib/ai/tools/save-lesson");
			const result = await saveLessonTool.execute!(
				{ category: params.category, title: params.title, content: params.content, context: params.context },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			return {
				content: [{ type: "text" as const, text: (result as any).message ?? "经验已保存" }],
				details: result,
			};
		},
	});

	// ── list-lessons ─────────────────────────────────────────────────────

	pi.registerTool({
		name: "list-lessons",
		label: "List Lessons",
		description: "列出知识库中所有经验教训。",
		promptSnippet: "列出经验教训",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params) {
			const { listLessonsTool } = await import("../../src/lib/ai/tools/list-lessons");
			const result = await listLessonsTool.execute!(
				{},
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
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

	// ── merge-lessons ────────────────────────────────────────────────────

	pi.registerTool({
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
			mergeIds: Type.Array(Type.String(), { description: "要合并删除的教训 ID 列表" }),
			mergedTitle: Type.String({ description: "合并后的标题" }),
			mergedContent: Type.String({ description: "合并后的内容（综合各条精华，精炼表述）" }),
			mergedCategory: StringEnum(
				["pattern", "anti-pattern", "tip", "pitfall"] as const,
				{ description: "合并后的类别" },
			),
			mergedContext: Type.Optional(Type.String({ description: "合并后的触发场景" })),
		}),
		async execute(_toolCallId, params) {
			const { mergeLessonsTool } = await import("../../src/lib/ai/tools/merge-lessons");
			const result = await mergeLessonsTool.execute!(
				{
					keepId: params.keepId,
					mergeIds: params.mergeIds,
					mergedTitle: params.mergedTitle,
					mergedContent: params.mergedContent,
					mergedCategory: params.mergedCategory,
					mergedContext: params.mergedContext,
				},
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			return {
				content: [{ type: "text" as const, text: (result as any).message ?? "合并完成" }],
				details: result,
			};
		},
	});

	// ── test-command ─────────────────────────────────────────────────────

	pi.registerTool({
		name: "test-command",
		label: "Test Command",
		description:
			"测试已注册的 / 命令是否正常工作。返回 _testVerdict: pass/warn/fail。fail 时查看 _errorDetail 修复。",
		promptSnippet: "测试斜杠命令",
		promptGuidelines: [
			"Use test-command after create-command to verify the command works correctly.",
		],
		parameters: Type.Object({
			command: Type.String({ description: "要测试的完整命令，如 'word-stats' 或 'prefix-search app'（不含 / 前缀）" }),
		}),
		async execute(_toolCallId, params) {
			const { testCommandTool } = await import("../../src/lib/ai/tools/test-command");
			const result = await testCommandTool.execute!(
				{ command: params.command },
				{ toolCallId: "pi", messages: [], abortSignal: undefined },
			);

			return {
				content: [{ type: "text" as const, text: (result as any).message ?? "测试完成" }],
				details: result,
			};
		},
	});

// ── safe-ls ─────────────────────────────────────────────────────────────
// Restricted bash replacement: only allows `ls` for directory listing.
// Prevents Agent from running destructive commands (npm, rm, node, etc.)

pi.registerTool({
	name: "safe-ls",
	label: "List Directory",
	description: "列出目录内容。只能执行 ls 命令查看文件结构，不能执行其他 shell 命令。",
	promptSnippet: "查看目录结构",
	parameters: Type.Object({
		path: Type.Optional(Type.String({ description: "要列出的目录路径（默认为项目根目录）" })),
	}),
	async execute(_toolCallId, params) {
		const dir = params.path || process.cwd();
		// Security: only allow ls, reject any other command
		const { execSync } = await import("child_process");
		try {
			const output = execSync(`ls -la ${JSON.stringify(dir)}`, {
				encoding: "utf-8",
				timeout: 5000,
				cwd: process.cwd(),
			});
			return {
				content: [{ type: "text" as const, text: output }],
			};
		} catch (err: any) {
			return {
				content: [{ type: "text" as const, text: `Error: ${err.message}` }],
				isError: true,
			};
		}
	},
});
}
