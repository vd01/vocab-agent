"use client";

import React, { useState, useEffect, Suspense } from "react";
import { type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WordCard } from "@/components/vocab/word-card";
import { PronounceButton } from "@/components/vocab/pronounce-button";
import { ReviewSession } from "@/components/vocab/review-session";
import { DynamicRenderer } from "@/components/generative/dynamic-renderer";
import { componentRegistry } from "@/components/generative/component-registry";
import { PinButton } from "@/components/pinned/pin-button";
import { notifyPinChange } from "@/components/pinned/pin-events";

// Read at module level so Next.js can tree-shake when disabled
const DEBUG_PANEL_ENABLED = process.env.NEXT_PUBLIC_DEBUG_PANEL === "true";

interface MessageItemProps {
	message: UIMessage;
	isLastAssistant?: boolean;
	isStreaming?: boolean;
	/** If this message contains a review session, is it the latest one? */
	isLastReview?: boolean;
}

/**
 * Check if a message part is a tool part (AI SDK V7: type starts with 'tool-').
 * Returns the tool metadata if it is, or null otherwise.
 */
function parseToolPart(part: any): {
	toolCallId: string;
	toolName: string;
	state: string;
	input: any;
	output: any;
	errorText?: string;
} | null {
	if (!part || typeof part.type !== "string") return null;

	// AI SDK V7: tool parts have type 'tool-<name>'
	if (part.type.startsWith("tool-")) {
		return {
			toolCallId: part.toolCallId,
			toolName: part.toolName ?? part.type.replace(/^tool-/, ""),
			state: part.state,
			input: part.input,
			output: part.output,
			errorText: part.errorText,
		};
	}

	return null;
}

export function MessageItem({
	message,
	isLastAssistant,
	isStreaming,
	isLastReview = true,
}: MessageItemProps) {
	const isUser = message.role === "user";

	// Merge consecutive reasoning parts into one group for cleaner display
	const mergedParts = mergeReasoningParts(message.parts ?? []);

	// Format timestamp (UIMessage may have createdAt from DB)
	const createdAt = (message as any).createdAt;
	const timeStr = createdAt ? formatTime(new Date(createdAt)) : null;

	// Extract review session data from tool outputs — render it full-width outside the avatar+content row
	const reviewData = (() => {
		if (isUser) return null;
		for (let i = mergedParts.length - 1; i >= 0; i--) {
			const part = mergedParts[i];
			if (part.type === 'tool' && part.state === 'output-available' && part.output?.type === 'due-words' && part.output.words) {
				return isLastReview ? part.output : null;
			}
		}
		return null;
	})();

	return (
		<div
			className={`flex flex-wrap ${isUser ? "justify-end" : "justify-start"} px-3 sm:px-4 py-2 sm:py-3`}
		>
			<div
				className={`flex gap-3 max-w-3xl w-full ${isUser ? "justify-end" : ""}`}
			>
				{/* Avatar for assistant */}
				{!isUser && (
					<div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
						<svg
							className="w-4 h-4 text-primary"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
							/>
						</svg>
					</div>
				)}
				<div className={`min-w-0 ${isUser ? "max-w-[85%]" : "mr-auto"}`}>
					{mergedParts.map((part, i) => {
						// Merged reasoning group
						if (part.type === "reasoning-group") {
							return (
								<details key={i} className="mt-2">
									<summary className="text-xs text-muted-foreground cursor-pointer select-none">
										思考过程（{part.count} 段）
									</summary>
									<div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap border-l-2 border-muted pl-2">
										{part.text}
									</div>
								</details>
							);
						}

						// Batch added words — collapsed compact list
						if (part.type === "batch-added") {
							return <BatchAddedWords key={i} items={part.items} />;
						}

						// Text part
						if (part.type === "text") {
							return isUser ? (
								<UserTextBubble key={i} text={part.text} />
							) : (
								<AssistantTextBubble key={i} text={part.text} />
							);
						}

						// Reasoning part (single, non-merged)
						if (part.type === "reasoning") {
							return (
								<details key={i} className="mt-2">
									<summary className="text-xs text-muted-foreground cursor-pointer select-none">
										思考过程
									</summary>
									<div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap border-l-2 border-muted pl-2">
										{part.text}
									</div>
								</details>
							);
						}

						// Tool part (AI SDK V7: type = 'tool-<name>')
						if (part.type === "tool") {
							const {
								toolCallId,
								toolName,
								state: toolState,
								input,
								output,
							} = part;

						// Tool is streaming input
						if (toolState === "input-streaming") {
							const displayName = TOOL_DISPLAY_NAMES[toolName] ?? toolName;
							return (
								<div
									key={i}
									className="mt-2 text-xs text-muted-foreground flex items-center gap-1"
								>
									<span className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
									准备执行 {displayName}...
								</div>
							);
						}

						// Tool is awaiting execution (input available, waiting for call)
						if (toolState === "input-available") {
							const displayName = TOOL_DISPLAY_NAMES[toolName] ?? toolName;
							return (
								<div
									key={i}
								className="mt-2 text-xs text-muted-foreground flex items-center gap-1"
								>
									<span className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
									执行 {displayName}...
								</div>
							);
						}

							// Tool completed with output
							if (toolState === "output-available" && output != null) {
								// Review session is rendered separately below — skip here
								if (output.type === 'due-words' && output.words) return null;
								return renderToolOutput(i, toolName, output, isLastReview);
							}

						// Tool error
						if (toolState === "output-error") {
							const errorText = part.errorText ?? "执行出错";
							const displayName = TOOL_DISPLAY_NAMES[toolName] ?? toolName;
							return (
								<div key={i} className="mt-2 text-xs text-red-500">
									{displayName}: {errorText}
								</div>
							);
						}

							return null;
						}

						return null;
					})}

					{/* Token usage badge (debug panel only) — read from message metadata */}
					{!isUser &&
						DEBUG_PANEL_ENABLED &&
						(message as any).metadata?.tokenUsage && (
							<TokenUsageBadge usage={(message as any).metadata.tokenUsage} />
						)}
					{/* Agent status indicator — only on the last assistant message */}
					{!isUser && isLastAssistant && (
						<AgentStatus message={message} isStreaming={!!isStreaming} />
					)}
					{/* Timestamp */}
					{timeStr && (
						<div
							className={`mt-1 text-[10px] text-muted-foreground/50 ${isUser ? "text-right" : ""}`}
						>
							{timeStr}
						</div>
					)}
				</div>
			</div>
			{/* Review session — full-width, outside the avatar+content row */}
			{reviewData && (
				<div className="max-w-lg w-full mt-1">
					<ReviewSession words={reviewData.words} queueInfo={reviewData.queueInfo} />
				</div>
			)}
		</div>
	);
}

// ── Developer tool output (collapsed) ─────────────────────────────────────

const DEV_TOOL_LABELS: Record<string, { icon: string; label: string }> = {
	"file-read": { icon: "R", label: "读取文件" },
	"file-list": { icon: "L", label: "列出文件" },
	"file-write": { icon: "⚠", label: "写文件(引导)" },
	"file-edit": { icon: "⚠", label: "编辑文件(引导)" },
	"register-tool": { icon: "T", label: "注册工具" },
	"register-component": { icon: "C", label: "注册组件" },
	"create-command": { icon: "!", label: "创建命令" },
	"db-query": { icon: "D", label: "查询数据库" },
	"save-lesson": { icon: "S", label: "保存经验" },
	"list-lessons": { icon: "📋", label: "列出经验" },
	"merge-lessons": { icon: "🔗", label: "合并经验" },
	"test-command": { icon: "?", label: "测试命令" },
	"safe-ls": { icon: "L", label: "列出目录" },
	"read": { icon: "R", label: "读取文件" },
	"write": { icon: "W", label: "写文件" },
	"edit": { icon: "E", label: "编辑文件" },
	"readSeek_read": { icon: "R", label: "读取文件" },
	"readSeek_write": { icon: "W", label: "写文件" },
	"readSeek_edit": { icon: "E", label: "编辑文件" },
	"readSeek_grep": { icon: "G", label: "搜索内容" },
	"readSeek_search": { icon: "S", label: "语法搜索" },
	"readSeek_refs": { icon: "→", label: "查找引用" },
	"readSeek_rename": { icon: "✎", label: "重命名" },
	"readSeek_hover": { icon: "?", label: "查看符号" },
	"readSeek_def": { icon: "D", label: "查找定义" },
	"readSeek_check": { icon: "✓", label: "语法检查" },
};

function DevToolOutput({
	toolName,
	output,
}: {
	toolName: string;
	output: any;
	key: number;
}) {
	const [expanded, setExpanded] = useState(false);
	const meta = DEV_TOOL_LABELS[toolName] ?? { icon: "*", label: toolName };
	const isError = output.type === "error";

	// Build a short summary line
	let summary = "";
	if (toolName === "file-read") {
		summary =
			output.type === "success"
				? `${(output.content ?? "").length} 字符`
				: output.message;
	} else if (toolName === "file-list") {
		summary =
			output.type === "success"
				? `${(output.entries ?? []).length} 项`
				: output.message;
	} else {
		summary = output.message ?? JSON.stringify(output).slice(0, 80);
	}

	// Content to show when expanded
	let detailContent: string | null = null;
	if (toolName === "file-read" && output.type === "success") {
		detailContent = output.content;
	} else if (output.content && typeof output.content === "string") {
		detailContent = output.content;
	}

	return (
		<div
			className={`mt-1.5 rounded-lg border text-xs overflow-hidden ${isError ? "border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20" : "border-border bg-muted/30"}`}
		>
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/50 transition-colors"
			>
				<span
					className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${isError ? "bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-200" : "bg-muted text-muted-foreground"}`}
				>
					{meta.icon}
				</span>
				<span
					className={`font-medium ${isError ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
				>
					{meta.label}
				</span>
				<span
					className={`flex-1 truncate ${isError ? "text-red-500/80" : "text-muted-foreground/70"}`}
				>
					{summary}
				</span>
				{detailContent && (
					<svg
						className={`w-3.5 h-3.5 text-muted-foreground/50 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				)}
			</button>
			{expanded && detailContent && (
				<div className="px-2.5 pb-2 max-h-48 overflow-y-auto">
					<pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all font-mono">
						{detailContent.slice(0, 5000)}
						{detailContent.length > 5000 ? "\n... (truncated)" : ""}
					</pre>
				</div>
			)}
		</div>
	);
}

// ── File block collapsing ──────────────────────────────────────────────────

/**
 * Replace file block markers (<<<file-write:...>>>...<<<end>>>) with
 * compact collapsible labels. This hides the raw code from the chat display
 * while showing what files were written/edited.
 *
 * Handles both complete blocks (with <<<end>>>) and incomplete blocks
 * (still streaming, no <<<end>>> yet) so that code is hidden immediately
 * during streaming instead of flashing raw content.
 */
function collapseFileBlocks(text: string): string {
	// Replace all COMPLETE file-write blocks
	let result = text.replace(
		/<<<file-write:(.+?)>>>\n[\s\S]*?\n<<<end>>>/g,
		(_, filePath) => `\n> 📝 **写入** \`${filePath}\`\n`,
	);
	// Replace all COMPLETE file-edit insert blocks
	result = result.replace(
		/<<<file-edit:(.+?):insert:(\d+)>>>\n[\s\S]*?\n<<<end>>>/g,
		(_, filePath, line) => `\n> ✏️ **插入** \`${filePath}\` 第${line}行后\n`,
	);
	// Replace all COMPLETE file-edit replace blocks
	result = result.replace(
		/<<<file-edit:(.+?):replace:(\d+)-(\d+)>>>\n[\s\S]*?\n<<<end>>>/g,
		(_, filePath, start, end) =>
			`\n> ✏️ **替换** \`${filePath}\` 第${start}-${end}行\n`,
	);

	// Replace INCOMPLETE (still streaming) file-write blocks
	// These have <<<file-write:...>>> but no <<<end>>> yet
	result = result.replace(
		/<<<file-write:(.+?)>>>\n[\s\S]*$/g,
		(_, filePath) => `\n> 📝 **写入** \`${filePath}\` ...\n`,
	);
	// Replace INCOMPLETE file-edit insert blocks
	result = result.replace(
		/<<<file-edit:(.+?):insert:(\d+)>>>\n[\s\S]*$/g,
		(_, filePath, line) => `\n> ✏️ **插入** \`${filePath}\` 第${line}行后 ...\n`,
	);
	// Replace INCOMPLETE file-edit replace blocks
	result = result.replace(
		/<<<file-edit:(.+?):replace:(\d+)-(\d+)>>>\n[\s\S]*$/g,
		(_, filePath, start, end) =>
			`\n> ✏️ **替换** \`${filePath}\` 第${start}-${end}行 ...\n`,
	);

	return result;
}

// ── Assistant text bubble with Markdown rendering ──────────────────────────

const ASSISTANT_COLLAPSE_LINES = 30;

function AssistantTextBubble({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	const displayText = collapseFileBlocks(text);
	const lineCount = displayText.split('\n').length;
	const shouldCollapse = lineCount > ASSISTANT_COLLAPSE_LINES && !expanded;

	return (
		<div
			className="text-sm leading-relaxed text-foreground break-words
                    prose prose-sm max-w-none
                    prose-headings:text-foreground prose-headings:font-semibold
                    prose-p:my-1 prose-p:first:mt-0 prose-p:last:mb-0
                    prose-ul:my-1 prose-ol:my-1
                    prose-li:my-0.5
                    prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                    prose-code:before:content-[''] prose-code:after:content-['']
                    prose-pre:bg-muted prose-pre:border prose-pre:border-border
                    prose-strong:text-foreground
                    prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                    prose-table:text-xs prose-th:bg-muted prose-th:px-2 prose-th:py-1
                    prose-td:px-2 prose-td:py-1 prose-td:border prose-td:border-border
                    prose-hr:border-border
                    prose-blockquote:border-primary/30 prose-blockquote:text-muted-foreground"
		>
			{shouldCollapse ? (
				<>
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText.split('\n').slice(0, ASSISTANT_COLLAPSE_LINES).join('\n')}</ReactMarkdown>
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="mt-1 text-xs text-primary hover:underline"
					>
						展开全部 ({lineCount} 行)
					</button>
				</>
			) : (
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
			)}
		</div>
	);
}

// ── User text bubble with collapse for long messages ──────────────────────

const COLLAPSE_LINES = 6;

function UserTextBubble({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	const lineCount = text.split("\n").length;
	const shouldCollapse = lineCount > COLLAPSE_LINES;

	return (
		<div className="bg-primary text-primary-foreground rounded-2xl px-4 py-2.5 w-fit break-words max-w-full">
			<div
				className={`whitespace-pre-wrap text-sm leading-relaxed ${!expanded && shouldCollapse ? "line-clamp-6" : ""}`}
			>
				{text}
			</div>
			{shouldCollapse && (
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="mt-1 text-xs text-primary-foreground/70 hover:text-primary-foreground/90 transition-colors"
				>
					{expanded ? "收起" : `展开全部 (${lineCount} 行)`}
				</button>
			)}
		</div>
	);
}

// ── Batch added words (collapsed) ──────────────────────────────────────────

function BatchAddedWords({
	items,
}: {
	items: Array<{
		word: string;
		phonetic: string | null;
		audioUrl: string | null;
		definition: string | null;
		wordId: string;
		examples: any;
		tag: string | null;
		collins: number | null;
		message: string;
	}>;
}) {
	const [currentIndex, setCurrentIndex] = useState(0);

	const goTo = (idx: number) => {
		const clamped = Math.max(0, Math.min(idx, items.length - 1));
		setCurrentIndex(clamped);
	};

	const item = items[currentIndex];

	return (
		<div className="mt-2 rounded-xl border border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20 overflow-hidden">
			{/* Header with counter */}
			<div className="flex items-center justify-between px-3 py-2">
				<div className="flex items-center gap-2">
					<svg
						className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0"
						fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
					>
						<path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span className="text-sm font-medium text-green-700 dark:text-green-300">
						已添加 {items.length} 个单词
					</span>
				</div>
				{items.length > 1 && (
					<span className="text-xs text-muted-foreground">
						{currentIndex + 1} / {items.length}
					</span>
				)}
			</div>

			{/* Carousel: word cards with left/right navigation */}
			{items.length === 1 ? (
				/* Single item — show compact card */
				<div className="px-3 pb-2">
					<CompactWordCard item={items[0]} />
				</div>
			) : (
				<div className="relative">
					{/* Navigation arrows */}
					{currentIndex > 0 && (
						<button
							type="button"
							onClick={() => goTo(currentIndex - 1)}
							className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/80 dark:bg-muted/80 shadow-sm flex items-center justify-center hover:bg-white dark:hover:bg-muted transition-colors"
						>
							<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
							</svg>
						</button>
					)}
					{currentIndex < items.length - 1 && (
						<button
							type="button"
							onClick={() => goTo(currentIndex + 1)}
							className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/80 dark:bg-muted/80 shadow-sm flex items-center justify-center hover:bg-white dark:hover:bg-muted transition-colors"
						>
							<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
							</svg>
						</button>
					)}

					{/* Current card */}
					<div className="px-3 pb-2">
						<CompactWordCard item={item} />
					</div>

					{/* Dot indicators */}
					{items.length > 1 && (
						<div className="flex justify-center gap-1 pb-2">
							{items.map((_, idx) => (
								<button
									key={idx}
									type="button"
									onClick={() => goTo(idx)}
									className={`w-1.5 h-1.5 rounded-full transition-colors ${
										idx === currentIndex ? "bg-green-500" : "bg-green-300 dark:bg-green-800"
									}`}
								/>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ── Compact word card for carousel ────────────────────────────────────────

function CompactWordCard({ item }: {
	item: {
		word: string;
		phonetic: string | null;
		audioUrl: string | null;
		definition: string | null;
		wordId: string;
		tag: string | null;
		collins: number | null;
	};
}) {
	return (
		<div className="rounded-lg bg-white dark:bg-muted/50 p-2.5 space-y-1">
			<div className="flex items-baseline gap-1.5 flex-wrap">
				<span className="font-semibold text-sm">{item.word}</span>
				{item.phonetic && (
					<span className="text-xs text-muted-foreground">{item.phonetic}</span>
				)}
				<PronounceButton word={item.word} audioUrl={item.audioUrl} />
				{item.collins && (
					<span className="text-amber-500 text-[10px]">
						{"★".repeat(item.collins)}
					</span>
				)}
				{item.tag && (
					<span className="text-[10px] px-1 py-0 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
						{item.tag.split(/\s+/)[0]}
					</span>
				)}
			</div>
			{item.definition && (
				<div className="text-xs text-muted-foreground line-clamp-2">
					{item.definition.split("\n")[0]}
				</div>
			)}
		</div>
	);
}

// ── Extracted words panel with "Add All" button ───────────────────────────

function ExtractedWordsPanel({
	words: extractedWords,
	knownCount,
	group,
	message,
}: {
	words: Array<{
		word: string;
		phonetic: string | null;
		translation: string | null;
		tag: string | null;
		collins: number | null;
	}>;
	knownCount: number;
	group: string | null;
	message: string;
}) {
	const [addingAll, setAddingAll] = useState(false);
	const [addResult, setAddResult] = useState<any>(null);
	const [selectedGroup, setSelectedGroup] = useState<string>(group ?? "日常");
	const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
	const [groupsLoaded, setGroupsLoaded] = useState(false);

	// Fetch available groups on first render
	useEffect(() => {
		if (groupsLoaded) return;
		fetch("/api/groups")
			.then(r => r.json())
			.then(data => {
				setGroups(data.groups ?? []);
				setGroupsLoaded(true);
				// Default to the group suggested by extract-words, or "日常"
				if (!group && data.groups?.length > 0) {
					const defaultGroup = data.groups.find((g: any) => g.isDefault);
					if (defaultGroup) setSelectedGroup(defaultGroup.name);
				}
			})
			.catch(() => setGroupsLoaded(true));
	}, [groupsLoaded, group]);

	const handleAddAll = () => {
		if (addingAll) return;
		setAddingAll(true);
		const wordList = extractedWords.map(w => w.word);
		const message = `请使用 batch-add-words 工具将以下单词添加到词库：${wordList.join(", ")}，分组为"${selectedGroup}"`;
		// Dispatch a custom event that ChatPanel listens to
		window.dispatchEvent(new CustomEvent("vocab-send-message", { detail: { message } }));
		setAddResult({ success: true, message: "已发送添加请求" });
		setAddingAll(false);
	};

	return (
		<div className="mt-2 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2">
				<div className="flex items-center gap-2">
					<svg className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
						<path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
					</svg>
					<span className="text-sm font-medium text-blue-700 dark:text-blue-300">
						提取了 {extractedWords.length} 个生词
					</span>
					{knownCount > 0 && (
						<span className="text-xs text-muted-foreground">
							（已认识 {knownCount} 个）
						</span>
					)}
				</div>
			</div>

			{/* Word list */}
			<div className="px-3 pb-2 max-h-64 overflow-y-auto space-y-1">
				{extractedWords.map((w, i) => (
					<div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-blue-100 dark:border-blue-900/50 last:border-0">
						<div className="flex-1 min-w-0">
							<div className="flex items-baseline gap-1.5 flex-wrap">
								<span className="font-semibold text-sm">{w.word}</span>
								{w.phonetic && (
									<span className="text-muted-foreground">{w.phonetic}</span>
								)}
								{w.collins && (
									<span className="text-amber-500 text-[10px]">
										{"★".repeat(w.collins)}
									</span>
								)}
								{w.tag && (
									<span className="text-[10px] px-1 py-0 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
										{w.tag.split(/\s+/)[0]}
									</span>
								)}
							</div>
							{w.translation && (
								<div className="text-muted-foreground mt-0.5 line-clamp-2">
									{w.translation}
								</div>
							)}
						</div>
					</div>
				))}
			</div>

			{/* Group selector + Add All button */}
			{!addResult && (
				<div className="px-3 pb-2 pt-1 space-y-2">
					{/* Group selector */}
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground shrink-0">添加到分组：</span>
						<select
							value={selectedGroup}
							onChange={e => setSelectedGroup(e.target.value)}
							className="flex-1 text-xs px-2 py-1 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-blue-400"
						>
							{groups.map(g => (
								<option key={g.id} value={g.name}>{g.name}</option>
							))}
							{!groupsLoaded && <option value="日常">日常</option>}
						</select>
					</div>
					{/* Add button */}
					<button
						type="button"
						onClick={handleAddAll}
						disabled={addingAll}
						className="w-full py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
					>
						{addingAll ? (
							<>
								<span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
								添加中...
							</>
						) : (
							<>
								<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
									<path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
								</svg>
								全部添加到词库
							</>
						)}
					</button>
				</div>
			)}
			{addResult && (
				<div className={`px-3 pb-2 pt-1 text-xs ${addResult.success ? "text-green-600" : "text-red-500"}`}>
					{addResult.message}
				</div>
			)}
		</div>
	);
}

// ── Batch add result (from batch-add-words tool) ──────────────────────────

function BatchAddResult({ output }: { output: any }) {
	const addedItems = (output.results ?? []).filter((r: any) => r.type === "added");
	const errorItems = (output.results ?? []).filter((r: any) => r.type === "error");
	const skippedItems = (output.results ?? []).filter((r: any) => r.type === "already-exists");
	const [currentIndex, setCurrentIndex] = useState(0);

	const goTo = (idx: number) => {
		setCurrentIndex(Math.max(0, Math.min(idx, addedItems.length - 1)));
	};

	return (
		<div className="mt-2 rounded-xl border border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20 overflow-hidden">
			{/* Summary header */}
			<div className="flex items-center justify-between px-3 py-2">
				<div className="flex items-center gap-2">
					<svg className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
						<path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span className="text-sm font-medium text-green-700 dark:text-green-300">
						{output.message}
					</span>
				</div>
				{addedItems.length > 1 && (
					<span className="text-xs text-muted-foreground">
						{currentIndex + 1} / {addedItems.length}
					</span>
				)}
			</div>

			{/* Carousel of added words */}
			{addedItems.length > 0 && (
				<>
					{addedItems.length === 1 ? (
						<div className="px-3 pb-2">
							<CompactWordCard item={addedItems[0]} />
						</div>
					) : (
						<div className="relative">
							{currentIndex > 0 && (
								<button
									type="button"
									onClick={() => goTo(currentIndex - 1)}
									className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/80 dark:bg-muted/80 shadow-sm flex items-center justify-center hover:bg-white dark:hover:bg-muted transition-colors"
								>
									<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
										<path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
									</svg>
								</button>
							)}
							{currentIndex < addedItems.length - 1 && (
								<button
									type="button"
									onClick={() => goTo(currentIndex + 1)}
									className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/80 dark:bg-muted/80 shadow-sm flex items-center justify-center hover:bg-white dark:hover:bg-muted transition-colors"
								>
									<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
										<path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
									</svg>
								</button>
							)}
							<div className="px-3 pb-2">
								<CompactWordCard item={addedItems[currentIndex]} />
							</div>
							<div className="flex justify-center gap-1 pb-2">
								{addedItems.map((_: any, idx: number) => (
									<button
										key={idx}
										type="button"
										onClick={() => goTo(idx)}
										className={`w-1.5 h-1.5 rounded-full transition-colors ${
											idx === currentIndex ? "bg-green-500" : "bg-green-300 dark:bg-green-800"
										}`}
									/>
								))}
							</div>
						</div>
					)}
				</>
			)}

			{/* Error items (if any) */}
			{errorItems.length > 0 && (
				<div className="px-3 pb-2 space-y-0.5">
					{errorItems.map((item: any, i: number) => (
						<div key={i} className="text-xs text-red-500">
							{item.message}
						</div>
					))}
				</div>
			)}

			{/* Skipped items (collapsed) */}
			{skippedItems.length > 0 && (
				<details className="px-3 pb-2">
					<summary className="text-xs text-muted-foreground cursor-pointer">
						{skippedItems.length} 个词已在词库中
					</summary>
					<div className="mt-1 flex flex-wrap gap-1">
						{skippedItems.map((item: any, i: number) => (
							<span key={i} className="text-xs bg-muted rounded px-1.5 py-0.5">{item.word}</span>
						))}
					</div>
				</details>
			)}
		</div>
	);
}

// ── Tool output renderer ──────────────────────────────────────────────────

function renderToolOutput(
	key: number,
	toolName: string,
	output: any,
	isLastReview: boolean,
) {
	// Review session is now rendered outside the avatar+content row for full width
	// Stale review sessions show a collapsed summary
	if (output.type === "due-words" && output.words) {
		return (
			<div key={key} className="mt-2">
				<div className="text-xs text-muted-foreground mb-1.5">
					复习（{output.words.length} 个单词）— 已过期
				</div>
				<div className="space-y-0.5">
					{output.words.map((w: any, wi: number) => (
						<div
							key={wi}
							className="text-xs text-muted-foreground/70 flex items-center gap-1.5"
						>
							<span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
							<span className="font-medium">{w.word}</span>
							{w.phonetic && <span>{w.phonetic}</span>}
						</div>
					))}
				</div>
			</div>
		);
	}

	if (output.type === "review-result") {
		return (
			<div key={key} className="mt-2 text-xs text-muted-foreground">
				评分: {output.rating} | 下次复习: {output.scheduledDays} 天后
			</div>
		);
	}

	if (output.type === "added") {
		return (
			<div key={key} className="mt-2 space-y-2">
				<div className="text-xs text-green-600">{output.message}</div>
				<WordCard
					wordId={output.wordId}
					word={output.word}
					phonetic={output.phonetic}
					audioUrl={output.audioUrl}
					definition={output.definition}
					examples={
						output.examples
							? typeof output.examples === "string"
								? output.examples
								: JSON.stringify(output.examples)
							: null
					}
					groups={output.group ? [output.group] : undefined}
					topRightSlot={<PinButton wordId={output.wordId} word={output.word} />}
				/>
			</div>
		);
	}

	if (output.type === "already-exists") {
		return (
			<div key={key} className="mt-2 text-xs text-yellow-600">
				{output.message}
			</div>
		);
	}

	if (output.type === "found") {
		return (
			<div key={key} className="mt-2">
				<WordCard
					wordId={output.wordId}
					word={output.word}
					phonetic={output.phonetic}
					audioUrl={output.audioUrl}
					definition={output.definition}
					examples={output.examples}
					groups={output.groups}
					topRightSlot={<PinButton wordId={output.wordId} word={output.word} />}
				/>
			</div>
		);
	}

	if (output.type === "not-found") {
		return (
			<div key={key} className="mt-2 text-xs text-muted-foreground">
				{output.message}
			</div>
		);
	}

	// Dictionary lookup result (not in user's library)
	if (output.type === "dict-found") {
		return (
			<div key={key} className="mt-2 space-y-2">
				<div className="flex items-baseline gap-2">
					<span className="text-base font-bold">{output.word}</span>
					{output.phonetic && (
						<span className="text-xs text-muted-foreground">
							{output.phonetic}
						</span>
					)}
					<PronounceButton
						word={output.word}
						audioUrl={output.audioUrl}
						size="md"
					/>
					{output.collins && (
						<span className="text-xs text-amber-500">
							{"★".repeat(output.collins)}
						</span>
					)}
				</div>

				{/* Exam tags */}
				{output.tag && (
					<div className="flex flex-wrap gap-1">
						{output.tag
							.split(/\s+/)
							.filter(Boolean)
							.map((t: string) => (
								<span
									key={t}
									className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
								>
									{t}
								</span>
							))}
					</div>
				)}

				{/* Chinese translation */}
				{output.translation && (
					<div className="text-sm">
						{output.translation
							.split("\n")
							.filter(Boolean)
							.map((line: string, idx: number) => (
								<div key={idx}>{line}</div>
							))}
					</div>
				)}

				{/* English definitions with examples */}
				{output.definitions?.length > 0 && (
					<div className="space-y-1.5">
						{output.definitions.map((group: any, gi: number) => (
							<div key={gi}>
								{group.partOfSpeech && (
									<span className="text-xs italic text-muted-foreground mr-1">
										{group.partOfSpeech}
									</span>
								)}
								{group.definitions?.slice(0, 3).map((d: any, di: number) => (
									<div key={di} className="text-xs ml-2">
										<span className="text-muted-foreground">{di + 1}. </span>
										{d.definition}
										{d.example && (
											<div className="text-muted-foreground italic ml-3">
												— {d.example}
											</div>
										)}
									</div>
								))}
							</div>
						))}
					</div>
				)}

				{/* Synonyms / Antonyms */}
				{(output.synonyms?.length > 0 || output.antonyms?.length > 0) && (
					<div className="text-xs space-y-0.5">
						{output.synonyms?.length > 0 && (
							<div>
								<span className="text-muted-foreground">同义: </span>
								{output.synonyms.slice(0, 8).join(", ")}
							</div>
						)}
						{output.antonyms?.length > 0 && (
							<div>
								<span className="text-muted-foreground">反义: </span>
								{output.antonyms.slice(0, 8).join(", ")}
							</div>
						)}
					</div>
				)}

				{/* Hint: not in library */}
				{output.hint && (
					<div className="text-[10px] text-muted-foreground italic">
						{output.hint}
					</div>
				)}

				{/* Frequency info */}
				{(output.bnc || output.frq) && (
					<div className="text-[10px] text-muted-foreground">
						词频: BNC #{output.bnc ?? "-"} / 当代 #{output.frq ?? "-"}
					</div>
				)}
			</div>
		);
	}

	if (output.type === "no-due-words") {
		return (
			<div key={key} className="mt-2 text-sm text-muted-foreground">
				{output.message}
			</div>
		);
	}

	// Extracted words from text — show list with "Add All" button
	if (output.type === "extracted-words" && output.words) {
		return (
			<ExtractedWordsPanel
				key={key}
				words={output.words}
				knownCount={output.knownCount}
				group={output.group}
				message={output.message}
			/>
		);
	}

	if (output.type === "all-known") {
		return (
			<div key={key} className="mt-2 text-sm text-green-600">
				{output.message}
			</div>
		);
	}

	if (output.type === "no-words") {
		return (
			<div key={key} className="mt-2 text-sm text-muted-foreground">
				{output.message}
			</div>
		);
	}

	// Batch add result — show carousel of added words
	if (output.type === "batch-added") {
		return (
			<BatchAddResult key={key} output={output} />
		);
	}

	if (output.type === "pinned") {
		return (
			<div key={key} className="mt-2 space-y-2">
				<div className="text-xs text-primary flex items-center gap-1.5">
					<PinChangeNotifier />
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="currentColor"
						stroke="none"
					>
						<path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
					</svg>
					{output.message}
				</div>
				{output.wordId && output.definition && (
					<WordCard
						wordId={output.wordId}
						word={output.word}
						phonetic={output.phonetic || null}
						audioUrl={output.audioUrl ?? null}
						definition={output.definition}
						examples={null}
						topRightSlot={
							<PinButton wordId={output.wordId} word={output.word} />
						}
					/>
				)}
			</div>
		);
	}

	if (output.type === "already-pinned") {
		return (
			<div key={key} className="mt-2 text-xs text-muted-foreground">
				{output.message}
			</div>
		);
	}

	if (output.type === "unpinned") {
		return (
			<div key={key} className="mt-2 text-xs text-muted-foreground">
				<PinChangeNotifier />
				{output.message}
			</div>
		);
	}

	if (output.type === "pin-full") {
		return (
			<div key={key} className="mt-2 text-xs text-yellow-600">
				{output.message}
			</div>
		);
	}

	if (output.type === "full") {
		return (
			<div key={key} className="mt-2 text-xs text-yellow-600">
				{output.message}
			</div>
		);
	}

	// Generic message (for dynamic commands that return formatted text)
	if (output.type === "message") {
		return (
			<div key={key} className="mt-2">
				<AssistantTextBubble text={output.message} />
			</div>
		);
	}

	// Stats result
	if (output.type === "stats") {
		return (
			<div key={key} className="mt-2 space-y-2">
				<div className="text-sm font-medium flex items-center gap-1.5">
					<svg className="size-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
						<path strokeLinecap="round" strokeLinejoin="round" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
					</svg>
					学习统计{output.group ? ` — ${output.group}` : ""}
				</div>
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-xs">
					<div className="rounded-xl border border-border bg-card p-3 sm:p-4 flex flex-col">
						<div className="text-muted-foreground text-[10px] sm:text-xs mb-1">总词汇量</div>
						<div className="text-xl sm:text-2xl font-bold text-foreground">{output.totalWords}</div>
					</div>
					<div className="rounded-xl border border-border bg-card p-3 sm:p-4 flex flex-col">
						<div className="text-muted-foreground text-[10px] sm:text-xs mb-1">今日复习</div>
						<div className="text-xl sm:text-2xl font-bold text-foreground">
							{output.daily?.reviewed ?? 0}
						</div>
					</div>
					<div className="rounded-xl border border-border bg-card p-3 sm:p-4 flex flex-col">
						<div className="text-muted-foreground text-[10px] sm:text-xs mb-1">今日正确率</div>
						<div className="text-xl sm:text-2xl font-bold text-foreground">
							{output.daily?.correctRate ?? 0}%
						</div>
					</div>
					<div className="rounded-xl border border-border bg-card p-3 sm:p-4 flex flex-col">
						<div className="text-muted-foreground text-[10px] sm:text-xs mb-1">学习中</div>
						<div className="text-xl sm:text-2xl font-bold text-foreground">
							{output.distribution?.learning ?? 0}
						</div>
					</div>
				</div>
				{output.groupDistribution && output.groupDistribution.length > 0 && (
					<div className="space-y-1">
						<div className="text-xs text-muted-foreground">分组分布</div>
						<div className="flex flex-wrap gap-1.5">
							{output.groupDistribution.map((g: any) => (
								<span
									key={g.id}
									className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
								>
									{g.name} ({g.wordCount})
								</span>
							))}
						</div>
					</div>
				)}
			</div>
		);
	}

	// Group management results
	if (output.type === "group-list") {
		return (
			<div key={key} className="mt-2 space-y-1.5">
				<div className="text-sm font-medium">分组列表</div>
				{output.groups?.map((g: any) => (
					<div key={g.id} className="text-xs flex items-center gap-2">
						<span className="font-medium">{g.name}</span>
						{g.isDefault && (
							<span className="text-[10px] text-muted-foreground">(默认)</span>
						)}
						<span className="text-muted-foreground">{g.wordCount} 词</span>
					</div>
				))}
			</div>
		);
	}

	if (
		[
			"group-created",
			"group-deleted",
			"group-renamed",
			"group-switched",
			"word-added-to-group",
			"word-removed-from-group",
			"already-member",
		].includes(output.type)
	) {
		return (
			<div key={key} className="mt-2 text-xs text-green-600">
				{output.message}
			</div>
		);
	}

// Command error / unknown / invalid-args

	// Command error / unknown / invalid-args

	// Developer tools: file operations & shell — compact collapsed display
	const devToolNames = new Set([
		"file-read",
		"file-list",
		"register-tool",
		"register-component",
		"create-command",
		"db-query",
		"save-lesson",
		"list-lessons",
		"merge-lessons",
		"test-command",
		"file-write",
		"file-edit",
	]);

	// Internal pi-readseek tools — suppress output entirely.
	// These tools return raw LINE:HASH anchors and file contents that are
	// only useful to the agent, not the user. The agent synthesizes
	// the information into its text response.
	const suppressedToolNames = new Set([
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
		"read", // pi built-in read
		"write", // pi built-in write
		"edit", // pi built-in edit
	]);

	if (suppressedToolNames.has(toolName)) {
		return null;
	}

	if (devToolNames.has(toolName)) {
		return <DevToolOutput key={key} toolName={toolName} output={output} />;
	}

	// Check dynamic component registry — match by output.type first, then toolName
	const componentName = componentRegistry.has(output.type)
		? output.type
		: componentRegistry.has(toolName)
			? toolName
			: null;
	console.log(`[renderToolOutput] toolName=${toolName}, output.type=${output.type}, componentName=${componentName}, registryKeys=[${Array.from(componentRegistry.getAll().keys()).join(',')}]`);
	if (componentName) {
		return (
			<div key={key} className="mt-2">
				<DynamicRenderer componentName={componentName} props={output} />
			</div>
		);
	}

	// Fallback: render as JSON
	return (
		<div key={key} className="mt-2 text-xs text-muted-foreground">
			[{toolName}] {JSON.stringify(output).slice(0, 200)}
		</div>
	);
}

// ── Token usage badge (debug panel only) ──────────────────────────────────

function TokenUsageBadge({
	usage,
}: {
	usage: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
		elapsedMs?: number;
		tokensPerSec?: string;
	};
}) {
	if (!usage) return null;

	const { inputTokens, outputTokens, totalTokens, elapsedMs, tokensPerSec } =
		usage;

	// Format elapsed time
	const elapsedSec = elapsedMs != null ? (elapsedMs / 1000).toFixed(1) : null;

	return (
		<div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/60 select-none">
			<svg
				className="w-3 h-3"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={2}
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M13 10V3L4 14h7v7l9-11h-7z"
				/>
			</svg>
			<span>↑{inputTokens ?? 0}</span>
			<span>↓{outputTokens ?? 0}</span>
			{totalTokens != null && <span>Σ{totalTokens}</span>}
			{tokensPerSec != null && tokensPerSec !== "-" && (
				<span>{tokensPerSec} tok/s</span>
			)}
			{elapsedSec != null && <span>{elapsedSec}s</span>}
		</div>
	);
}

// ── Agent status indicator ──────────────────────────────────────────────

type AgentPhase =
	| "reasoning"
	| "calling-tool"
	| "generating"
	| "done"
	| "step-limit"
	| "error"
	| "idle";

function detectPhase(message: UIMessage, isStreaming: boolean): AgentPhase {
	if (!isStreaming) {
		// Not streaming — check for step-limit first
		const hasStepLimit = message.parts?.some(
			(p) => p.type === "text" && p.text?.includes("步数限制中断"),
		);
		if (hasStepLimit) return "step-limit";

		// Check for errors in tool parts
		const hasError = message.parts?.some((p) =>
			isToolPartWithState(p, "output-error"),
		);
		if (hasError) return "error";

		// If the message has any content, it's done
		const hasContent = message.parts?.some(
			(p) =>
				(p.type === "text" && p.text) ||
				isToolPartWithState(p, "output-available"),
		);
		return hasContent ? "done" : "idle";
	}

	// Streaming — inspect parts to determine phase
	const parts = message.parts ?? [];

	// Check for a tool currently being called
	const callingTool = parts.find(
		(p) =>
			isToolPartWithState(p, "input-available") ||
			isToolPartWithState(p, "input-streaming"),
	);
	if (callingTool) {
		return "calling-tool";
	}

	// Check for reasoning in progress (reasoning part exists but no text yet after it)
	const lastPart = parts[parts.length - 1];
	if (lastPart?.type === "reasoning") {
		return "reasoning";
	}

	// Otherwise, generating text
	return "generating";
}

/** Check if a part is a tool part (type starts with 'tool-') with the given state */
function isToolPartWithState(part: any, state: string): boolean {
	if (!part || typeof part.type !== "string") return false;
	return part.type.startsWith("tool-") && part.state === state;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
	"file-read": "读取文件",
	"file-list": "列出文件",
	"file-write": "写文件(引导)",
	"file-edit": "编辑文件(引导)",
	"create-command": "创建命令",
	"register-tool": "注册命令",
	"register-component": "注册组件",
	"db-query": "查询数据库",
	"fsrs-review": "获取复习单词",
	"fsrs-rate": "提交评分",
	"add-word": "添加单词",
	"vocab-lookup": "查询单词",
	"extract-words": "提炼生词",
	"save-lesson": "保存经验",
	"list-lessons": "列出经验",
	"merge-lessons": "合并经验",
	"test-command": "测试命令",
	"dict-lookup": "查词典",
	"vocab-stats": "词库统计",
	"safe-ls": "列出目录",
	"read": "读取文件",
	"write": "写文件",
	"edit": "编辑文件",
	"readSeek_read": "读取文件",
	"readSeek_write": "写文件",
	"readSeek_edit": "编辑文件",
	"readSeek_grep": "搜索内容",
	"readSeek_search": "语法搜索",
	"readSeek_refs": "查找引用",
	"readSeek_rename": "重命名",
	"readSeek_hover": "查看符号",
	"readSeek_def": "查找定义",
	"readSeek_check": "语法检查",
};

function AgentStatus({
	message,
	isStreaming,
}: {
	message: UIMessage;
	isStreaming: boolean;
}) {
	const phase = detectPhase(message, isStreaming);

	// For command results (stats, review, etc.) that have no text content,
	// don't show "已完成" — the result card itself is self-explanatory
	const hasTextContent = message.parts?.some(
		(p) => p.type === "text" && p.text && p.text.trim().length > 0,
	);
	const hasToolOutput = message.parts?.some(
		(p) => isToolPartWithState(p, "output-available"),
	);
	// If this message only has tool output and no text, suppress the "done" status
	if (phase === "done" && hasToolOutput && !hasTextContent) {
		return null;
	}

	// Idle — no content yet, don't show anything (MessageList's "思考中..." handles this)
	if (phase === "idle") return null;

	// Error — tool returned an error (persistent, won't disappear)
	if (phase === "error") {
		const errorPart = message.parts?.find((p) =>
			isToolPartWithState(p, "output-error"),
		) as any;
		const errorMsg = errorPart?.errorText ?? "执行出错";
		return (
			<div className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
				<svg
					className="w-3 h-3"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={3}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
				{errorMsg}
			</div>
		);
	}

	// Done — persistent check mark, never disappears
	if (phase === "done") {
		return (
			<div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
				<svg
					className="w-3 h-3 text-green-500"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={3}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M5 13l4 4L19 7"
					/>
				</svg>
				已完成
			</div>
		);
	}

	// Step limit reached — task incomplete
	if (phase === "step-limit") {
		return (
			<div className="mt-2 flex items-center gap-1.5 text-xs text-amber-500">
				<svg
					className="w-3 h-3"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={3}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M12 9v2m0 4v.01M12 2l9.5 16.5H2.5L12 2z"
					/>
				</svg>
				未完成（步数限制）— 回复"继续"可接着做
			</div>
		);
	}

	// Active phases — show pulsing indicator with phase label
	const callingToolPart = message.parts?.find(
		(p) =>
			isToolPartWithState(p, "input-available") ||
			isToolPartWithState(p, "input-streaming"),
	) as any;

	let label: string;
	if (phase === "reasoning") {
		label = "思考中...";
	} else if (phase === "calling-tool" && callingToolPart) {
		const rawName =
			callingToolPart.toolName ??
			callingToolPart.type?.replace(/^tool-/, "") ??
			"";
		const displayName = TOOL_DISPLAY_NAMES[rawName] ?? rawName;
		label = `执行 ${displayName}...`;
	} else {
		label = "生成中...";
	}

	return (
		<div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
			<span className="relative flex h-2 w-2">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
				<span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
			</span>
			{label}
		</div>
	);
}

// ── Merge consecutive reasoning parts ───────────────────────────────────

type MergedPart =
	| { type: "reasoning-group"; text: string; count: number }
	| { type: "text"; text: string }
	| { type: "reasoning"; text: string }
	| {
			type: "tool";
			toolCallId: string;
			toolName: string;
			state: string;
			input: any;
			output: any;
			errorText?: string;
	  }
	| {
			type: "batch-added";
			items: Array<{
				word: string;
				phonetic: string | null;
				audioUrl: string | null;
				definition: string | null;
				wordId: string;
				examples: any;
				tag: string | null;
				collins: number | null;
				message: string;
			}>;
	  };

function mergeReasoningParts(parts: any[]): MergedPart[] {
	const result: MergedPart[] = [];
	const reasoningTexts: string[] = [];

	// Collect all reasoning texts, emit everything else
	for (const part of parts) {
		if (part.type === "reasoning") {
			reasoningTexts.push(part.text || "");
		} else if (part.type === "text") {
			result.push({ type: "text", text: part.text });
		} else if (typeof part.type === "string" && part.type.startsWith("tool-")) {
			// AI SDK V7 tool part: type = 'tool-<name>'
			result.push({
				type: "tool",
				toolCallId: part.toolCallId,
				toolName: part.toolName ?? part.type.replace(/^tool-/, ""),
				state: part.state,
				input: part.input,
				output: part.output,
				errorText: part.errorText,
			});
		}
	}

	// Prepend a single merged reasoning block if any reasoning exists
	if (reasoningTexts.length > 0) {
		const text = reasoningTexts.join("\n\n---\n\n");
		const merged: MergedPart[] =
			reasoningTexts.length === 1
				? [{ type: "reasoning", text }]
				: [{ type: "reasoning-group", text, count: reasoningTexts.length }];
		result.unshift(...merged);
	}

	// Merge consecutive 'added' tool outputs into a single 'batch-added' group
	const merged: MergedPart[] = [];
	let batch: Array<{
		word: string;
		phonetic: string | null;
		audioUrl: string | null;
		definition: string | null;
		wordId: string;
		examples: any;
		tag: string | null;
		collins: number | null;
		message: string;
	}> = [];

	const flushBatch = () => {
		if (batch.length === 0) return;
		if (batch.length === 1) {
			// Single item — keep as individual tool part for normal rendering
			const item = batch[0];
			merged.push({
				type: "tool",
				toolCallId: "",
				toolName: "add-word",
				state: "output-available",
				input: {},
				output: {
					type: "added",
					wordId: item.wordId,
					word: item.word,
					phonetic: item.phonetic,
					audioUrl: item.audioUrl,
					definition: item.definition,
					examples: item.examples,
					tag: item.tag,
					collins: item.collins,
					message: item.message,
				},
			});
		} else {
			merged.push({ type: "batch-added", items: [...batch] });
		}
		batch = [];
	};

	for (const part of result) {
		if (
			part.type === "tool" &&
			part.state === "output-available" &&
			part.output?.type === "added"
		) {
			batch.push({
				word: part.output.word,
				phonetic: part.output.phonetic ?? null,
				audioUrl: part.output.audioUrl ?? null,
				definition: part.output.definition ?? null,
				wordId: part.output.wordId,
				examples: part.output.examples,
				tag: part.output.tag ?? null,
				collins: part.output.collins ?? null,
				message: part.output.message,
			});
		} else {
			flushBatch();
			merged.push(part);
		}
	}
	flushBatch();

	return merged;
}

// ── Time formatting ──────────────────────────────────────────────────────

function formatTime(date: Date): string {
	const now = new Date();
	const isToday = date.toDateString() === now.toDateString();

	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const time = `${hours}:${minutes}`;

	if (isToday) return time;

	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	return `${month}-${day} ${time}`;
}

function PinChangeNotifier() {
	useEffect(() => {
		notifyPinChange();
	}, []);
	return null;
}

