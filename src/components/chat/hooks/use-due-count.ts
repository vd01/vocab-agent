"use client";

/**
 * useDueCount — manages due word count polling and notification events
 * Extracted from chat-panel.tsx
 */

import { useState, useEffect, useRef } from "react";
import { NotificationManager } from "@/lib/notification/notification-manager";
import { cachedFetch } from "@/lib/fetch-cache";

interface DueBreakdown {
	newDue: number;
	reviewDue: number;
	newQueued: number;
}

export function useDueCount() {
	const [dueCount, setDueCount] = useState(0);
	const [dueBreakdown, setDueBreakdown] = useState<DueBreakdown>({
		newDue: 0,
		reviewDue: 0,
		newQueued: 0,
	});
	const rateRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	useEffect(() => {
		const nm = NotificationManager.getInstance();
		nm.init();

		const fetchDueInfo = async () => {
			try {
				const data = await cachedFetch<{ due?: number; newDue?: number; reviewDue?: number; newQueued?: number }>('/api/review-due');
				setDueCount(data.due ?? 0);
				setDueBreakdown({
					newDue: data.newDue ?? 0,
					reviewDue: data.reviewDue ?? 0,
					newQueued: data.newQueued ?? 0,
				});
			} catch (err) {
				console.warn("[useDueCount] Failed to fetch due info:", err);
			}
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

		// Refresh due count when returning from another window (e.g. Tauri quick-lookup)
		// with 10s cooldown to avoid redundant refreshes on normal tab switching
		let lastDueRefresh = 0;
		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				const now = Date.now();
				if (now - lastDueRefresh > 10_000) {
					lastDueRefresh = now;
					fetchDueInfo();
				}
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			unsub();
			clearInterval(dueCountTimer);
			if (rateRefreshTimerRef.current)
				clearTimeout(rateRefreshTimerRef.current);
			window.removeEventListener("review-word-rated", onWordRated);
			window.removeEventListener("review-session-completed", onSessionCompleted);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	return { dueCount, dueBreakdown };
}
