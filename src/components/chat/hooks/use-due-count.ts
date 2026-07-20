"use client";

/**
 * useDueCount — manages due word count polling and notification events
 * Extracted from chat-panel.tsx
 */

import { useState, useEffect, useRef } from "react";
import { NotificationManager } from "@/lib/notification/notification-manager";

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

		// Refresh when page becomes visible (e.g. returning from Tauri quick-lookup
		// where words may have been added to the library with new FSRS cards)
		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				fetchDueInfo();
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
