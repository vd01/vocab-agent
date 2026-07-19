"use client";

/**
 * MessageItem — renders a single chat message
 *
 * Refactored from 1817-line monolith into ~200 lines by extracting:
 *   - Text bubbles → tool-renderers/text-bubbles.tsx
 *   - Tool output renderers → tool-renderers/registry.tsx
 *   - BatchAddedWords → tool-renderers/batch-added-words.tsx
 *   - DevToolOutput → tool-renderers/dev-tool-output.tsx
 *   - AgentStatus → tool-renderers/agent-status.tsx
 *   - TokenUsageBadge → tool-renderers/token-usage-badge.tsx
 *   - Merge logic → tool-renderers/merge-parts.ts
 *   - Constants/utils → tool-renderers/utils.ts
 */

import React from "react";
import { type UIMessage } from "ai";
import { ReviewSession } from "@/components/vocab/review-session";
import {
	AssistantTextBubble,
	UserTextBubble,
} from "@/components/tool-renderers/text-bubbles";
import { BatchAddedWords } from "@/components/tool-renderers/batch-added-words";
import { AgentStatus } from "@/components/tool-renderers/agent-status";
import { TokenUsageBadge } from "@/components/tool-renderers/token-usage-badge";
import { renderToolOutput } from "@/components/tool-renderers/registry";
import { mergeReasoningParts } from "@/components/tool-renderers/merge-parts";
import { TOOL_DISPLAY_NAMES } from "@/components/tool-renderers/utils";
import type { MergedPart } from "@/components/tool-renderers/merge-parts";
import { formatTime } from "@/components/tool-renderers/utils";

const DEBUG_PANEL_ENABLED = process.env.NEXT_PUBLIC_DEBUG_PANEL === "true";

interface MessageItemProps {
	message: UIMessage;
	isLastAssistant?: boolean;
	isStreaming?: boolean;
	isLastReview?: boolean;
}

export function MessageItem({
	message,
	isLastAssistant,
	isStreaming,
	isLastReview = true,
}: MessageItemProps) {
	const isUser = message.role === "user";
	const mergedParts = mergeReasoningParts(message.parts ?? []);
	const createdAt = (message as any).createdAt;
	const timeStr = createdAt ? formatTime(new Date(createdAt)) : null;

	// Extract review session data from tool outputs (full-width, outside avatar row)
	const reviewData = (() => {
		if (isUser) return null;
		for (let i = mergedParts.length - 1; i >= 0; i--) {
			const part = mergedParts[i];
			if (
				part.type === "tool" &&
				part.state === "output-available" &&
				part.output?.type === "due-words" &&
				part.output.words
			) {
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
				{!isUser && <AssistantAvatar />}
				<div className={`min-w-0 ${isUser ? "max-w-[85%]" : "max-w-[90%]"}`}>
					{mergedParts.map((part, i) =>
						renderPart(part, i, isUser, isLastReview),
					)}
					{!isUser &&
						DEBUG_PANEL_ENABLED &&
						(message as any).metadata?.tokenUsage && (
							<TokenUsageBadge usage={(message as any).metadata.tokenUsage} />
						)}
					{!isUser && isLastAssistant && (
						<AgentStatus message={message} isStreaming={!!isStreaming} />
					)}
					{timeStr && (
						<div
							className={`mt-1 text-[10px] text-muted-foreground/50 ${isUser ? "text-right" : ""}`}
						>
							{timeStr}
						</div>
					)}
				</div>
			</div>
			{reviewData && (
				<div className="w-full mt-1 pl-10 sm:pl-10">
					<div className="max-w-lg w-full">
						<ReviewSession
							words={reviewData.words}
							queueInfo={reviewData.queueInfo}
						/>
					</div>
				</div>
			)}
		</div>
	);
}

// ── Part renderer ────────────────────────────────────────────────────────

function renderPart(
	part: MergedPart,
	i: number,
	isUser: boolean,
	isLastReview: boolean,
): React.ReactNode {
	if (part.type === "batch-added") {
		return <BatchAddedWords key={i} items={part.items} />;
	}

	if (part.type === "text") {
		const text = part.text?.trim() ?? "";
		if (!text) return null;
		return isUser ? (
			<UserTextBubble key={i} text={text} />
		) : (
			<AssistantTextBubble key={i} text={text} />
		);
	}

	if (part.type === "reasoning" || part.type === "reasoning-group") {
		// Reasoning is intentionally hidden in the chat UI — it is available in the
		// debug panel if needed. Showing it here creates a redundant small bubble.
		return null;
	}

	if (part.type === "tool") {
		return renderToolPart(part, i, isLastReview);
	}

	return null;
}

function renderToolPart(
	part: MergedPart & { type: "tool" },
	i: number,
	isLastReview: boolean,
): React.ReactNode {
	const { toolName, state: toolState, output } = part;

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

	if (toolState === "output-available" && output != null) {
		// Review session is rendered separately below — skip here
		if (output.type === "due-words" && output.words) return null;
		return renderToolOutput(i, toolName, output);
	}

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

// ── Assistant avatar ─────────────────────────────────────────────────────

function AssistantAvatar() {
	return (
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
	);
}
