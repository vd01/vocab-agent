"use client";

/**
 * useCommandInterceptor — / command execution logic
 * Extracted from chat-panel.tsx
 */

import { useCallback, useRef } from "react";
import type { UIMessage } from "ai";
import { useGroup } from "@/lib/groups/group-context";

interface UseCommandInterceptorOptions {
	setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
	devModeRef: React.MutableRefObject<boolean>;
	sendMessage: (opts: { text: string }) => void;
}

export function useCommandInterceptor({
	setMessages,
	devModeRef,
	sendMessage,
}: UseCommandInterceptorOptions) {
	const { activeGroup, refreshGroups } = useGroup();
	const activeGroupRef = useRef(activeGroup);
	activeGroupRef.current = activeGroup;

	// Monotonic counter ensures unique IDs even within the same millisecond
	const idCounterRef = useRef(0);
	const nextId = useCallback(
		(prefix: string) => `${prefix}-${Date.now()}-${++idCounterRef.current}`,
		[],
	);

	/**
	 * Try to execute a / command directly.
	 * Returns true if the command exists and was executed, false if unknown.
	 */
	const tryExecuteCommand = useCallback(
		async (command: string): Promise<boolean> => {
			const cmdName = command.split(/\s+/)[0].slice(1);

			let finalCommand = command;
			const currentGroup = activeGroupRef.current;
			if (currentGroup) {
				if (cmdName === "review") {
					const args = command.split(/\s+/).slice(1);
					const hasGroupArg = args.some((a) => !/^\d+$/.test(a));
					if (!hasGroupArg) {
						const numArg = args.find((a) => /^\d+$/.test(a));
						finalCommand = numArg
							? `/review ${numArg} ${currentGroup}`
							: `/review ${currentGroup}`;
					}
				} else if (cmdName === "stats") {
					const args = command.split(/\s+/).slice(1);
					if (args.length === 0) {
						finalCommand = `/stats ${currentGroup}`;
					}
				}
			}

			const userMsg: UIMessage = {
				id: nextId("cmd-user"),
				role: "user",
				parts: [{ type: "text", text: command }],
			};
			setMessages((prev) => [...prev, userMsg]);

			try {
				const res = await fetch("/api/commands", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ command: finalCommand }),
				});

				const contentType = res.headers.get("content-type");
				const responseText = await res.text();
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}: ${responseText.slice(0, 200)}`);
				}

				let result: any;
				if (contentType?.includes("application/json")) {
					result = JSON.parse(responseText);
				} else {
					throw new Error(
						`Expected JSON, got ${contentType}: ${responseText.slice(0, 200)}`,
					);
				}

				if (result.type === "unknown-command") {
					setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
					return false;
				}

				const assistantMsg: UIMessage = {
					id: nextId("cmd-result"),
					role: "assistant",
					parts: [
						{
							type: `tool-${cmdName}`,
							toolCallId: nextId("cmd"),
							state: "output-available",
							input: {},
							output: result,
						},
					],
				};
				setMessages((prev) => [...prev, assistantMsg]);

				// Save command messages to DB
				setTimeout(() => {
					fetch("/api/messages", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							messages: [userMsg, assistantMsg],
							agentType: devModeRef.current ? "developer" : "teacher",
						}),
					}).catch((err) =>
						console.error("[ChatPanel] Failed to save command messages:", err),
					);
				}, 100);

				// Refresh group info after vocab-modifying commands
				const vocabCommands = ["add", "group", "stats"];
				if (vocabCommands.includes(cmdName)) {
					refreshGroups();
				}

				return true;
			} catch (err) {
				const errorMsg: UIMessage = {
					id: nextId("cmd-error"),
					role: "assistant",
					parts: [
						{
							type: "text",
							text: `命令执行失败: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
				};
				setMessages((prev) => [...prev, errorMsg]);
				return true;
			}
		},
		[setMessages, refreshGroups, devModeRef],
	);

	// Custom submit handler that intercepts / commands
	const handleSubmit = useCallback(
		(e: React.FormEvent, input: string, setInput: (v: string) => void) => {
			e.preventDefault();
			if (!input?.trim()) return;

			const trimmed = input.trim();

			if (trimmed.startsWith("/")) {
				if (!devModeRef.current) {
					tryExecuteCommand(trimmed);
					setInput("");
					return;
				}
				tryExecuteCommand(trimmed).then((executed) => {
					if (!executed) {
						sendMessage({ text: input });
					}
				});
				setInput("");
				return;
			}

			sendMessage({ text: input });
			setInput("");
		},
		[tryExecuteCommand, sendMessage, devModeRef],
	);

	return { tryExecuteCommand, handleSubmit, refreshGroups, activeGroup };
}
