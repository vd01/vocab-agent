"use client";

/**
 * AgentStatus — phase indicator for assistant messages
 * Extracted from message-item.tsx
 */

import React from "react";
import type { UIMessage } from "ai";
import { TOOL_DISPLAY_NAMES } from "./utils";

type AgentPhase =
	| "reasoning"
	| "calling-tool"
	| "generating"
	| "done"
	| "step-limit"
	| "error"
	| "idle";

function isToolPartWithState(part: any, state: string): boolean {
	if (!part || typeof part.type !== "string") return false;
	return part.type.startsWith("tool-") && part.state === state;
}

function detectPhase(message: UIMessage, isStreaming: boolean): AgentPhase {
	if (!isStreaming) {
		const hasStepLimit = message.parts?.some(
			(p) => p.type === "text" && p.text?.includes("步数限制中断"),
		);
		if (hasStepLimit) return "step-limit";

		const hasError = message.parts?.some((p) =>
			isToolPartWithState(p, "output-error"),
		);
		if (hasError) return "error";

		const hasContent = message.parts?.some(
			(p) =>
				(p.type === "text" && p.text) ||
				isToolPartWithState(p, "output-available"),
		);
		return hasContent ? "done" : "idle";
	}

	const parts = message.parts ?? [];

	const callingTool = parts.find(
		(p) =>
			isToolPartWithState(p, "input-available") ||
			isToolPartWithState(p, "input-streaming"),
	);
	if (callingTool) return "calling-tool";

	const lastPart = parts[parts.length - 1];
	if (lastPart?.type === "reasoning") return "reasoning";

	return "generating";
}

export function AgentStatus({
	message,
	isStreaming,
}: {
	message: UIMessage;
	isStreaming: boolean;
}) {
	const phase = detectPhase(message, isStreaming);

	const hasTextContent = message.parts?.some(
		(p) => p.type === "text" && p.text && p.text.trim().length > 0,
	);
	const hasToolOutput = message.parts?.some((p) =>
		isToolPartWithState(p, "output-available"),
	);
	if (phase === "done" && hasToolOutput && !hasTextContent) return null;
	if (phase === "idle") return null;

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
