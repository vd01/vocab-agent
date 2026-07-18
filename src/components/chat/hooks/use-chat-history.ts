"use client";

/**
 * useChatHistory — message loading, pagination, and persistence
 * Extracted from chat-panel.tsx
 */

import { useState, useCallback, useRef } from "react";
import type { UIMessage } from "ai";

interface UseChatHistoryOptions {
	messages: UIMessage[];
	setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
	devModeRef: React.MutableRefObject<boolean>;
	initialHasMore?: boolean;
}

export function useChatHistory({
	messages,
	setMessages,
	devModeRef,
	initialHasMore = true,
}: UseChatHistoryOptions) {
	const [hasMore, setHasMore] = useState(initialHasMore);
	const [loadingMore, setLoadingMore] = useState(false);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const messagesRef = useRef(messages);
	messagesRef.current = messages;

	// Save current messages to DB
	const saveMessagesToDb = useCallback(async () => {
		try {
			const currentMessages = messagesRef.current;
			if (currentMessages.length === 0) return;
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
	}, [devModeRef]);

	// Debounced save — call this whenever messages change significantly
	const debouncedSave = useCallback(() => {
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => {
			saveMessagesToDb();
		}, 1000);
	}, [saveMessagesToDb]);

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

	// Clear chat history
	const handleClearChat = useCallback(async () => {
		try {
			const res = await fetch("/api/messages", { method: "DELETE" });
			if (res.ok) {
				setMessages([]);
				setHasMore(false);
				console.log("[ChatPanel] Chat history cleared");
			} else {
				console.error("[ChatPanel] Failed to clear chat:", await res.text());
			}
		} catch (err) {
			console.error("[ChatPanel] Failed to clear chat:", err);
		}
	}, [setMessages]);

	return {
		hasMore,
		loadingMore,
		saveMessagesToDb,
		debouncedSave,
		handleLoadMore,
		handleClearChat,
	};
}
