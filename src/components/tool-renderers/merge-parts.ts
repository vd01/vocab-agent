"use client";

/**
 * MergedPart types and mergeReasoningParts utility
 * — extracted from message-item.tsx
 */

export type MergedPart =
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

export function mergeReasoningParts(parts: any[]): MergedPart[] {
	const result: MergedPart[] = [];
	const reasoningTexts: string[] = [];

	for (const part of parts) {
		if (part.type === "reasoning") {
			reasoningTexts.push(part.text || "");
		} else if (part.type === "text") {
			result.push({ type: "text", text: part.text });
		} else if (typeof part.type === "string" && part.type.startsWith("tool-")) {
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

	if (reasoningTexts.length > 0) {
		const text = reasoningTexts.join("\n\n---\n\n");
		const merged: MergedPart[] =
			reasoningTexts.length === 1
				? [{ type: "reasoning", text }]
				: [{ type: "reasoning-group", text, count: reasoningTexts.length }];
		result.unshift(...merged);
	}

	// Merge consecutive 'added' tool outputs into a single 'batch-added' group
	const mergedResult: MergedPart[] = [];
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
			const item = batch[0];
			mergedResult.push({
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
			mergedResult.push({ type: "batch-added", items: [...batch] });
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
			mergedResult.push(part);
		}
	}
	flushBatch();

	return mergedResult;
}
