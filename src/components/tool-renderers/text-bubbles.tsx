"use client";

/**
 * Text bubble components — extracted from message-item.tsx
 *
 * AssistantTextBubble: Markdown rendering with collapse for long messages
 * UserTextBubble: Simple text bubble with collapse
 */

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── File block collapsing ──────────────────────────────────────────────────

function collapseFileBlocks(text: string): string {
	let result = text.replace(
		/<<<file-write:(.+?)>>>\n[\s\S]*?\n<<<end>>>/g,
		(_, filePath) => `\n> 📝 **写入** \`${filePath}\`\n`,
	);
	result = result.replace(
		/<<<file-edit:(.+?):insert:(\d+)>>>\n[\s\S]*?\n<<<end>>>/g,
		(_, filePath, line) => `\n> ✏️ **插入** \`${filePath}\` 第${line}行后\n`,
	);
	result = result.replace(
		/<<<file-edit:(.+?):replace:(\d+)-(\d+)>>>\n[\s\S]*?\n<<<end>>>/g,
		(_, filePath, start, end) =>
			`\n> ✏️ **替换** \`${filePath}\` 第${start}-${end}行\n`,
	);
	result = result.replace(
		/<<<file-write:(.+?)>>>\n[\s\S]*$/g,
		(_, filePath) => `\n> 📝 **写入** \`${filePath}\` ...\n`,
	);
	result = result.replace(
		/<<<file-edit:(.+?):insert:(\d+)>>>\n[\s\S]*$/g,
		(_, filePath, line) => `\n> ✏️ **插入** \`${filePath}\` 第${line}行后 ...\n`,
	);
	result = result.replace(
		/<<<file-edit:(.+?):replace:(\d+)-(\d+)>>>\n[\s\S]*$/g,
		(_, filePath, start, end) =>
			`\n> ✏️ **替换** \`${filePath}\` 第${start}-${end}行 ...\n`,
	);
	return result;
}

// ── Assistant text bubble ──────────────────────────────────────────────────

const ASSISTANT_COLLAPSE_LINES = 30;

export function AssistantTextBubble({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	const displayText = collapseFileBlocks(text);
	const lineCount = displayText.split("\n").length;
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
					<ReactMarkdown remarkPlugins={[remarkGfm]}>
						{displayText
							.split("\n")
							.slice(0, ASSISTANT_COLLAPSE_LINES)
							.join("\n")}
					</ReactMarkdown>
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

// ── User text bubble ──────────────────────────────────────────────────────

const COLLAPSE_LINES = 6;

export function UserTextBubble({ text }: { text: string }) {
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
