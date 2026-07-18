"use client";

/**
 * TokenUsageBadge — debug panel token usage display
 * Extracted from message-item.tsx
 */

import React from "react";

export function TokenUsageBadge({
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
