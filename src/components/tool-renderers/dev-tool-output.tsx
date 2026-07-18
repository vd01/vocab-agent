"use client";

/**
 * Developer tool output — collapsed compact display
 * Extracted from message-item.tsx
 */

import React, { useState } from "react";
import { DEV_TOOL_LABELS } from "./utils";

export function DevToolOutput({
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
