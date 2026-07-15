/**
 * ChatPanel (pi SDK version) — Uses usePiChat instead of useChat.
 *
 * This is a drop-in replacement for the original ChatPanel that:
 *   1. Uses usePiChat (pi SSE events) instead of useChat (AI SDK)
 *   2. Keeps the same message format (UIMessage) for message-item.tsx
 *   3. Keeps the same command interception logic
 *   4. Keeps the same UI layout
 *
 * To switch: rename this file to chat-panel.tsx and delete the old one.
 */

"use client";

import { usePiChat } from "@/lib/pi/use-pi-chat";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { DebugPanel, notifyDebugPanel } from "@/components/debug/debug-panel";
import { useGroup } from "@/lib/groups/group-context";
import { NotificationManager } from "@/lib/notification/notification-manager";
import { ReviewPromptBanner, useAutoReviewPrompt } from "@/components/notification/review-prompt-banner";
import { useState, useCallback, useEffect, useRef } from "react";
import type { UIMessage } from "ai";

// Read at module level so Next.js can tree-shake when disabled
const DEBUG_PANEL_ENABLED = process.env.NEXT_PUBLIC_DEBUG_PANEL === "true";

// Dynamic re-import to get the latest loadGeneratedComponents after HMR
async function reloadComponents() {
	try {
		const mod = await import("@/components/generative/component-registry?t=" + Date.now());
		mod.loadGeneratedComponents();
	} catch {
		const mod = await import("@/components/generative/component-registry");
		mod.loadGeneratedComponents();
	}
}

export function ChatPanel() {
	const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
	const [hasMore, setHasMore] = useState(true);

	// Load initial messages from DB on mount
	useEffect(() => {
		fetch("/api/messages?limit=20")
			.then((r) => r.json())
			.then((data) => {
				setInitialMessages(data.messages?.reverse() || []);
				setHasMore(data.hasMore ?? false);
			})
			.catch(() => {
				setInitialMessages([]);
			});
	}, []);

	if (initialMessages === null) {
		return (
			<div className="flex flex-col h-full w-full">
				<div className="flex-1 flex items-center justify-center">
					<div className="text-sm text-muted-foreground">加载中...</div>
				</div>
			</div>
		);
	}

	return (
		<ChatInner initialMessages={initialMessages} initialHasMore={hasMore} />
	);
}

function ChatInner({
	initialMessages,
	initialHasMore,
}: {
	initialMessages: UIMessage[];
	initialHasMore: boolean;
}) {
	const devModeRef = useRef(false);
	const { activeGroup } = useGroup();
	const activeGroupRef = useRef(activeGroup);
	activeGroupRef.current = activeGroup;

	const {
		messages,
		sendMessage,
		status,
		stop,
		setMessages,
		input,
		setInput,
		handleSubmit: piHandleSubmit,
		isLoading,
	} = usePiChat({
		api: "/api/chat", // Points to pi-route.ts (or route.ts during migration)
		body: () => {
			const switched = modeSwitchedRef.current;
			modeSwitchedRef.current = false;
			return {
				mode: devModeRef.current ? "develop" : "teach",
				modeSwitched: switched,
				activeGroup: activeGroup || null,
			};
		},
		messages: initialMessages,
		onFinish: () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			saveTimerRef.current = setTimeout(() => {
				saveMessagesToDb();
			}, 500);
			if (DEBUG_PANEL_ENABLED && debugIdRef.current) {
				notifyDebugPanel(debugIdRef.current);
				debugIdRef.current = null;
			}
		},
	});

	const [hasMore, setHasMore] = useState(initialHasMore);
	const [devMode, setDevModeState] = useState(false);
	const modeSwitchedRef = useRef(false);
	const setDevMode = useCallback((v: boolean) => {
		if (devModeRef.current !== v) {
			modeSwitchedRef.current = true;
		}
		devModeRef.current = v;
		setDevModeState(v);
	}, []);
	const [loadingMore, setLoadingMore] = useState(false);
	const [dueCount, setDueCount] = useState(0);
	const [dueBreakdown, setDueBreakdown] = useState<{
		newDue: number;
		reviewDue: number;
		newQueued: number;
	}>({ newDue: 0, reviewDue: 0, newQueued: 0 });
	const { showPrompt, dismiss: dismissPrompt, markReviewDone } =
		useAutoReviewPrompt(dueCount);
	const prevStatusRef = useRef<string>(status);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const rateRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const messagesRef = useRef(messages);
	const debugIdRef = useRef<string | null>(null);
	messagesRef.current = messages;

	// Load generated components on mount
	useEffect(() => {
		reloadComponents();
	}, []);

	// Initialize NotificationManager and fetch initial due count
	useEffect(() => {
		const nm = NotificationManager.getInstance();
		nm.init();

		const fetchDueInfo = async () => {
			try {
				const res = await fetch("/api/review-due");
				if (res.ok) {
					const data = await res.json();
					setDueCount(data.due ?? 0);
					setDueBreakdown({
						newDue: data.newDue ?? 0,
						reviewDue: data.reviewDue ?? 0,
						newQueued: data.newQueued ?? 0,
					});
				}
			} catch {}
		};
		fetchDueInfo();

		const unsub = nm.onDueWords((count) => {
			setDueCount(count);
		});

		const dueCountTimer = setInterval(fetchDueInfo, 5 * 60 * 1000);

		const onWordRated = () => {
			if (rateRefreshTimerRef.current)
				clearTimeout(rateRefreshTimerRef.current);
			rateRefreshTimerRef.current = setTimeout(fetchDueInfo, 1000);
		};
		const onSessionCompleted = () => {
			fetchDueInfo();
		};
		window.addEventListener("review-word-rated", onWordRated);
		window.addEventListener("review-session-completed", onSessionCompleted);

		return () => {
			unsub();
			clearInterval(dueCountTimer);
			if (rateRefreshTimerRef.current)
				clearTimeout(rateRefreshTimerRef.current);
			window.removeEventListener("review-word-rated", onWordRated);
			window.removeEventListener("review-session-completed", onSessionCompleted);
		};
	}, []);

	// Reload components after each Agent conversation ends
	useEffect(() => {
		const prev = prevStatusRef.current;
		prevStatusRef.current = status;
		if (prev === "streaming" && status === "ready") {
			reloadComponents();
		}
	}, [status]);

	// Save current messages to DB
	const saveMessagesToDb = useCallback(async () => {
		try {
			const currentMessages = messagesRef.current;
			const res = await fetch("/api/messages", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: currentMessages,
					agentType: devModeRef.current ? "developer" : "teacher",
				}),
			});
			const result = await res.json();
			if (result.saved > 0) {
				console.log(`[ChatPanel] Saved ${result.saved} messages to DB`);
			}
		} catch (err) {
			console.error("[ChatPanel] Failed to save messages:", err);
		}
	}, []);

	// Load more (older) messages on scroll to top
	const handleLoadMore = useCallback(async () => {
		if (loadingMore || !hasMore || messages.length === 0) return;
		setLoadingMore(true);

		try {
			const oldest = messages[0];
			const cursor = (oldest as any)?.seq;

			const res = await fetch(`/api/messages?cursor=${cursor}&limit=20`);
			const data = await res.json();

			if (data.messages && data.messages.length > 0) {
				const older = data.messages.reverse();
				setMessages((prev) => [...older, ...prev]);
				setHasMore(data.hasMore ?? false);
			} else {
				setHasMore(false);
			}
		} catch (err) {
			console.error("[ChatPanel] Failed to load more messages:", err);
		} finally {
			setLoadingMore(false);
		}
	}, [loadingMore, hasMore, messages, setMessages]);

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

			// Add user message
			const userMsg: UIMessage = {
				id: `cmd-user-${Date.now()}`,
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
					throw new Error(
						`HTTP ${res.status}: ${responseText.slice(0, 200)}`,
					);
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
					setMessages((prev) =>
						prev.filter((m) => m.id !== userMsg.id),
					);
					return false;
				}

				// Wrap result as assistant message with tool part
				const assistantMsg: UIMessage = {
					id: `cmd-result-${Date.now()}`,
					role: "assistant",
					parts: [
						{
							type: `tool-${cmdName}`,
							toolCallId: `cmd-${Date.now()}`,
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
							agentType: devModeRef.current
								? "developer"
								: "teacher",
						}),
					}).catch((err) =>
						console.error(
							"[ChatPanel] Failed to save command messages:",
							err,
						),
					);
				}, 100);

				return true;
			} catch (err) {
				const errorMsg: UIMessage = {
					id: `cmd-error-${Date.now()}`,
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
		[setMessages],
	);

	// Custom submit handler that intercepts / commands
	const handleSubmit = useCallback(
		(e: React.FormEvent) => {
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
		[input, sendMessage, tryExecuteCommand],
	);

	const handleCommand = useCallback((command: string) => {
		setInput(command + " ");
	}, []);

	const handleReview = useCallback(() => {
		markReviewDone();
		tryExecuteCommand("/review");
	}, [tryExecuteCommand, markReviewDone]);

	const handleStats = useCallback(() => {
		tryExecuteCommand("/stats");
	}, [tryExecuteCommand]);

	return (
		<div className="flex flex-col h-full w-full">
			{showPrompt && dueCount > 0 && !devMode && (
				<ReviewPromptBanner
					dueCount={dueCount}
					newDue={dueBreakdown.newDue}
					reviewDue={dueBreakdown.reviewDue}
					newQueued={dueBreakdown.newQueued}
					onStartReview={() => {
						markReviewDone();
						tryExecuteCommand("/review");
					}}
					onDismiss={dismissPrompt}
				/>
			)}
			<div className="flex-1 overflow-hidden">
				<div className="max-w-3xl mx-auto h-full">
					<MessageList
						messages={messages}
						isLoading={isLoading}
						hasMore={hasMore}
						loadingMore={loadingMore}
						onLoadMore={handleLoadMore}
					/>
				</div>
			</div>
			<div className="max-w-3xl mx-auto w-full">
				<ChatInput
					input={input}
					setInput={setInput}
					handleSubmit={handleSubmit}
					isLoading={isLoading}
					onStop={stop}
					onCommand={handleCommand}
					onReview={handleReview}
					onStats={handleStats}
					devMode={devMode}
					onDevModeChange={setDevMode}
					dueCount={dueCount}
				/>
			</div>
			{DEBUG_PANEL_ENABLED && <DebugPanel />}
		</div>
	);
}
