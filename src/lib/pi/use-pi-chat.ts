/**
 * usePiChat — Custom chat hook that consumes pi SDK SSE events
 * and produces UIMessage-compatible message state.
 *
 * This replaces @ai-sdk/react's useChat while keeping the same
 * message format that message-item.tsx expects.
 *
 * SSE events from /api/chat:
 *   text-delta     → append to current text chunk
 *   thinking-delta → append to reasoning text
 *   tool-start     → close current text chunk, add tool part (input-streaming)
 *   tool-result    → update tool part (output-available)
 *   agent-start    → mark loading
 *   agent-end      → mark done
 *   agent-settled  → mark fully done
 *   error          → show error
 */

"use client";

import { useState, useCallback, useRef } from "react";
import type { UIMessage } from "ai";

// ── Types ────────────────────────────────────────────────────────────────

interface UsePiChatOptions {
	api: string;
	body?: () => Record<string, unknown>;
	onFinish?: () => void;
	onToolResult?: (toolName: string, isError: boolean) => void;
	messages?: UIMessage[];
}

interface UsePiChatReturn {
	messages: UIMessage[];
	sendMessage: (input: { text: string }) => void;
	status: "ready" | "submitted" | "streaming" | "error";
	stop: () => void;
	setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
	input: string;
	setInput: React.Dispatch<React.SetStateAction<string>>;
	handleSubmit: (e: React.FormEvent) => void;
	isLoading: boolean;
}

// ── Part tracking ────────────────────────────────────────────────────────

interface TextChunk {
	kind: "text";
	key: string;
	text: string; // accumulated text for this chunk
}

interface ToolPart {
	kind: "tool";
	key: string; // toolCallId
	toolName: string;
	state: string;
	input: any;
	output: any;
}

type PartEntry = TextChunk | ToolPart;

// ── Hook ─────────────────────────────────────────────────────────────────

export function usePiChat(options: UsePiChatOptions): UsePiChatReturn {
	const {
		api,
		body,
		onFinish,
		onToolResult,
		messages: initialMessages,
	} = options;

	const [messages, setMessages] = useState<UIMessage[]>(initialMessages ?? []);
	const [status, setStatus] = useState<
		"ready" | "submitted" | "streaming" | "error"
	>("ready");
	const [input, setInput] = useState("");

	const abortRef = useRef<AbortController | null>(null);
	const assistantIdRef = useRef<string>("");
	const reasoningAccumRef = useRef<string>("");

	// Ordered list of parts as they appear in the stream
	const partsRef = useRef<PartEntry[]>([]);
	// Index of the currently accumulating text chunk (null if none)
	const currentTextIdxRef = useRef<number | null>(null);

	// Build the current assistant message from accumulated state
	const buildAssistantMessage = useCallback((): UIMessage => {
		const parts: any[] = [];

		// Reasoning part (if any) — always first
		if (reasoningAccumRef.current) {
			parts.push({
				type: "reasoning",
				text: reasoningAccumRef.current,
			});
		}

		// Build parts in the order they appeared in the stream
		for (const entry of partsRef.current) {
			if (entry.kind === "text") {
				if (entry.text) {
					parts.push({ type: "text", text: entry.text });
				}
			} else if (entry.kind === "tool") {
				parts.push({
					type: `tool-${entry.toolName}`,
					toolCallId: entry.key,
					toolName: entry.toolName,
					state: entry.state,
					input: entry.input,
					output: entry.output,
				});
			}
		}

		return {
			id: assistantIdRef.current,
			role: "assistant",
			parts,
		};
	}, []);

	// Update the assistant message in the messages array
	const updateAssistantInMessages = useCallback(() => {
		const assistantMsg = buildAssistantMessage();
		setMessages((prev) => {
			const idx = prev.findIndex((m) => m.id === assistantIdRef.current);
			if (idx === -1) return [...prev, assistantMsg];
			const next = [...prev];
			next[idx] = assistantMsg;
			return next;
		});
	}, [buildAssistantMessage]);

	// Send a message
	const sendMessage = useCallback(
		(inputData: { text: string }) => {
			const text = inputData.text.trim();
			if (!text) return;

			// Add user message
			const userMsg: UIMessage = {
				id: `user-${crypto.randomUUID()}`,
				role: "user",
				parts: [{ type: "text", text }],
			};

			// Reset assistant accumulation
			assistantIdRef.current = `asst-${crypto.randomUUID()}`;
			reasoningAccumRef.current = "";
			partsRef.current = [];
			currentTextIdxRef.current = null;

			// Add placeholder assistant message
			const assistantMsg: UIMessage = {
				id: assistantIdRef.current,
				role: "assistant",
				parts: [],
			};

			setMessages((prev) => {
				const existingIds = new Set(prev.map((m) => m.id));
				const toAdd = [userMsg, assistantMsg].filter(
					(m) => !existingIds.has(m.id),
				);
				return [...prev, ...toAdd];
			});
			setStatus("submitted");

			// Start SSE connection
			const abortController = new AbortController();
			abortRef.current = abortController;

			const requestBody = {
				message: text,
				...(body?.() ?? {}),
			};

			fetch(api, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
				signal: abortController.signal,
			})
				.then(async (response) => {
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}`);
					}

					const reader = response.body?.getReader();
					if (!reader) throw new Error("No response body");

					const decoder = new TextDecoder();
					let buffer = "";

					setStatus("streaming");

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;

						buffer += decoder.decode(value, { stream: true });

						// Process complete SSE messages
						const lines = buffer.split("\n\n");
						buffer = lines.pop() ?? "";

						for (const line of lines) {
							if (!line.startsWith("data: ")) continue;
							const jsonStr = line.slice(6);
							if (!jsonStr.trim()) continue;

							try {
								const event = JSON.parse(jsonStr);
								handleSSEEvent(event);
							} catch (err) {
								console.error("[usePiChat] SSE parse error:", err);
							}
						}
					}

					// Process remaining buffer
					if (buffer.startsWith("data: ")) {
						try {
							const event = JSON.parse(buffer.slice(6));
							handleSSEEvent(event);
						} catch {
							// Incomplete JSON in remaining buffer — ignore
						}
					}

					setStatus("ready");
					onFinish?.();
				})
				.catch((err) => {
					if (err.name === "AbortError") return;
					console.error("[usePiChat] Fetch error:", err);
					setStatus("error");
				});
		},
		[api, body, onFinish, onToolResult, updateAssistantInMessages],
	);

	// Handle individual SSE events
	const handleSSEEvent = useCallback(
		(event: Record<string, unknown>) => {
			const eventType = event.type as string;
			switch (eventType) {
				case "text-delta": {
					const delta = (event.delta ?? "") as string;
					// If no current text chunk, create one
					if (currentTextIdxRef.current === null) {
						const textIdx = partsRef.current.length;
						partsRef.current.push({
							kind: "text",
							key: `text-${textIdx}`,
							text: "",
						});
						currentTextIdxRef.current = textIdx;
					}
					// Append delta to current text chunk
					const entry = partsRef.current[
						currentTextIdxRef.current
					] as TextChunk;
					entry.text += delta;
					updateAssistantInMessages();
					break;
				}

				case "thinking-delta": {
					reasoningAccumRef.current += (event.delta ?? "") as string;
					updateAssistantInMessages();
					break;
				}

				case "tool-start": {
					const toolCallId = event.toolCallId as string;
					const toolName = event.toolName as string;
					// Close current text chunk
					currentTextIdxRef.current = null;
					// Add tool part
					partsRef.current.push({
						kind: "tool",
						key: toolCallId,
						toolName,
						state: "input-streaming",
						input: {},
						output: null,
					});
					updateAssistantInMessages();
					break;
				}

				case "tool-result": {
					const toolCallId = event.toolCallId as string;
					const toolName = event.toolName as string;
					const uiData = event.uiData as any;
					const isError = event.isError as boolean;

					const output = uiData ?? {
						type: "message",
						message: event.textContent ?? "Done",
					};

					onToolResult?.(toolName, isError);

					// Find and update the tool part
					const entry = partsRef.current.find(
						(p) => p.kind === "tool" && p.key === toolCallId,
					) as ToolPart | undefined;
					if (entry) {
						entry.state = isError ? "output-error" : "output-available";
						entry.output = output;
					}
					updateAssistantInMessages();
					break;
				}

				case "agent-start": {
					setStatus("streaming");
					break;
				}

				case "agent-end":
				case "agent-settled": {
					break;
				}

				case "error": {
					// Add error as a text chunk
					const errorIdx = partsRef.current.length;
					partsRef.current.push({
						kind: "text",
						key: `error-${errorIdx}`,
						text: `\n\n❌ 错误: ${event.message}`,
					});
					currentTextIdxRef.current = null;
					updateAssistantInMessages();
					break;
				}

				default: {
					// Ignore unhandled events (message_start, message_end, turn_start, turn_end, etc.)
					break;
				}
			}
		},
		[updateAssistantInMessages],
	);

	// Stop the current stream
	const stop = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setStatus("ready");
	}, []);

	// Form submit handler
	const handleSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			if (!input.trim()) return;
			sendMessage({ text: input });
			setInput("");
		},
		[input, sendMessage],
	);

	const isLoading = status === "submitted" || status === "streaming";

	return {
		messages,
		sendMessage,
		status,
		stop,
		setMessages,
		input,
		setInput,
		handleSubmit,
		isLoading,
	};
}
