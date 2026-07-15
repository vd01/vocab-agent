/**
 * usePiChat — Custom chat hook that consumes pi SDK SSE events
 * and produces UIMessage-compatible message state.
 *
 * This replaces @ai-sdk/react's useChat while keeping the same
 * message format that message-item.tsx expects.
 *
 * SSE events from /api/chat/pi-route:
 *   text-delta     → append to assistant text
 *   thinking-delta → append to reasoning text
 *   tool-start     → add tool part (input-streaming)
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

// ── Hook ─────────────────────────────────────────────────────────────────

export function usePiChat(options: UsePiChatOptions): UsePiChatReturn {
	const { api, body, onFinish, messages: initialMessages } = options;

	const [messages, setMessages] = useState<UIMessage[]>(
		initialMessages ?? [],
	);
	const [status, setStatus] = useState<
		"ready" | "submitted" | "streaming" | "error"
	>("ready");
	const [input, setInput] = useState("");

	const abortRef = useRef<AbortController | null>(null);
	const assistantIdRef = useRef<string>("");
	const textAccumRef = useRef<string>("");
	const reasoningAccumRef = useRef<string>("");
	const toolPartsRef = useRef<
		Map<
			string,
			{
				toolName: string;
				state: string;
				input: any;
				output: any;
			}
		>
	>(new Map());

	// Build the current assistant message from accumulated state
	const buildAssistantMessage = useCallback((): UIMessage => {
		const parts: any[] = [];

		// Reasoning part (if any)
		if (reasoningAccumRef.current) {
			parts.push({
				type: "reasoning",
				text: reasoningAccumRef.current,
			});
		}

		// Tool parts (in order of toolCallId)
		for (const [toolCallId, tool] of toolPartsRef.current) {
			parts.push({
				type: `tool-${tool.toolName}`,
				toolCallId,
				toolName: tool.toolName,
				state: tool.state,
				input: tool.input,
				output: tool.output,
			});
		}

		// Text part (if any)
		if (textAccumRef.current) {
			parts.push({
				type: "text",
				text: textAccumRef.current,
			});
		}

		return {
			id: assistantIdRef.current,
			role: "assistant",
			parts,
			createdAt: new Date(),
		};
	}, []);

	// Update the assistant message in the messages array
	const updateAssistantInMessages = useCallback(() => {
		const assistantMsg = buildAssistantMessage();
		setMessages((prev) => {
			const idx = prev.findIndex(
				(m) => m.id === assistantIdRef.current,
			);
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
				id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				role: "user",
				parts: [{ type: "text", text }],
				createdAt: new Date(),
			};

			// Reset assistant accumulation
			assistantIdRef.current = `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			textAccumRef.current = "";
			reasoningAccumRef.current = "";
			toolPartsRef.current = new Map();

			// Add placeholder assistant message
			const assistantMsg: UIMessage = {
				id: assistantIdRef.current,
				role: "assistant",
				parts: [],
				createdAt: new Date(),
			};

			setMessages((prev) => [...prev, userMsg, assistantMsg]);
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
						} catch {}
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
		[api, body, onFinish],
	);

	// Handle individual SSE events
	const handleSSEEvent = useCallback(
		(event: Record<string, unknown>) => {
			switch (event.type) {
				case "text-delta": {
					textAccumRef.current += event.delta ?? "";
					updateAssistantInMessages();
					break;
				}

				case "thinking-delta": {
					reasoningAccumRef.current += event.delta ?? "";
					updateAssistantInMessages();
					break;
				}

				case "tool-start": {
					const toolCallId = event.toolCallId as string;
					const toolName = event.toolName as string;
					toolPartsRef.current.set(toolCallId, {
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

					// The details from pi tool result become the output
					// If details has a 'type' field, use it directly
					// Otherwise wrap it
					const output = uiData ?? { type: "message", message: event.textContent ?? "Done" };

					toolPartsRef.current.set(toolCallId, {
						toolName,
						state: isError ? "output-error" : "output-available",
						input: {},
						output,
					});
					updateAssistantInMessages();
					break;
				}

				case "agent-start": {
					setStatus("streaming");
					break;
				}

				case "agent-end":
				case "agent-settled": {
					// Don't set ready yet — the fetch promise will do that
					break;
				}

				case "error": {
					console.error("[usePiChat] Agent error:", event.message);
					textAccumRef.current += `\n\n❌ 错误: ${event.message}`;
					updateAssistantInMessages();
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
