/**
 * ChatPanel (pi SDK version) — Uses usePiChat instead of useChat.
 *
 * Refactored to use extracted hooks:
 *   - useDueCount: due word count polling and notifications
 *   - useChatHistory: message loading, pagination, persistence
 *   - useCommandInterceptor: / command execution
 */

"use client";

import { usePiChat } from "@/lib/pi/use-pi-chat";
import { cachedFetch } from "@/lib/fetch-cache";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { DebugPanel, notifyDebugPanel } from "@/components/debug/debug-panel";
import {
	ReviewPromptBanner,
	useAutoReviewPrompt,
} from "@/components/notification/review-prompt-banner";
import { useDueCount } from "./hooks/use-due-count";
import { useChatHistory } from "./hooks/use-chat-history";
import { useCommandInterceptor } from "./hooks/use-command-interceptor";
import { useState, useCallback, useEffect, useRef } from "react";
import type { UIMessage } from "ai";

const DEBUG_PANEL_ENABLED = process.env.NEXT_PUBLIC_DEBUG_PANEL === "true";

async function reloadComponents() {
	try {
		const mod = await import("@/components/generative/component-registry");
		await mod.loadGeneratedComponents();
	} catch (err) {
		console.warn("[ChatPanel] reloadComponents failed:", err);
	}
}

export function ChatPanel() {
	const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
		null,
	);
	const [hasMore, setHasMore] = useState(true);

	useEffect(() => {
		cachedFetch<{ messages?: UIMessage[]; hasMore?: boolean }>('/api/messages?limit=20')
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
	const modeSwitchedRef = useRef(false);
	const [devMode, setDevModeState] = useState(false);

	const setDevMode = useCallback((v: boolean) => {
		if (devModeRef.current !== v) {
			modeSwitchedRef.current = true;
		}
		devModeRef.current = v;
		setDevModeState(v);
	}, []);

	const debugIdRef = useRef<string | null>(null);
	const prevStatusRef = useRef<string>("");

	const {
		messages,
		sendMessage,
		status,
		stop,
		setMessages,
		input,
		setInput,
		isLoading,
	} = usePiChat({
		api: "/api/chat",
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
			setTimeout(() => {
				saveMessagesToDb();
			}, 500);
			if (DEBUG_PANEL_ENABLED && debugIdRef.current) {
				notifyDebugPanel(debugIdRef.current);
				debugIdRef.current = null;
			}
		},
		onToolResult: (toolName: string) => {
			debouncedSave();
			const vocabTools = [
				"add-word",
				"batch-add-words",
				"import-by-tag",
				"group-manage",
				"extract-words",
			];
			if (vocabTools.includes(toolName)) {
				refreshGroups();
			}
		},
	});

	// Extracted hooks
	const { dueCount, dueBreakdown } = useDueCount();
	const {
		saveMessagesToDb,
		debouncedSave,
		handleLoadMore,
		handleClearChat,
		hasMore,
		loadingMore,
	} = useChatHistory({ messages, setMessages, devModeRef });
	const { tryExecuteCommand, handleSubmit, refreshGroups, activeGroup } =
		useCommandInterceptor({ setMessages, devModeRef, sendMessage });

	const {
		showPrompt,
		dismiss: dismissPrompt,
		markReviewDone,
	} = useAutoReviewPrompt(dueCount);

	// Load generated components on mount
	useEffect(() => {
		reloadComponents();
	}, []);

	// Listen for "add all words" events from ExtractedWordsPanel
	useEffect(() => {
		const handler = (e: Event) => {
			const { message } = (e as CustomEvent).detail;
			if (message) sendMessage({ text: message });
		};
		window.addEventListener("vocab-send-message", handler);
		return () => window.removeEventListener("vocab-send-message", handler);
	}, [sendMessage]);

	// Reload components after each Agent conversation ends
	useEffect(() => {
		const prev = prevStatusRef.current;
		prevStatusRef.current = status;
		if (prev === "streaming" && status === "ready") reloadComponents();
	}, [status]);

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
	const onSubmit = useCallback(
		(e: React.FormEvent) => {
			handleSubmit(e, input, setInput);
		},
		[handleSubmit, input],
	);

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
					handleSubmit={onSubmit}
					isLoading={isLoading}
					onStop={stop}
					onCommand={handleCommand}
					onReview={handleReview}
					onStats={handleStats}
					onClearChat={handleClearChat}
					devMode={devMode}
					onDevModeChange={setDevMode}
					dueCount={dueCount}
				/>
			</div>
			{DEBUG_PANEL_ENABLED && <DebugPanel />}
		</div>
	);
}
