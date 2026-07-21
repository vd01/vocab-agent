"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { NotificationManager } from "@/lib/notification/notification-manager";
import { cachedFetch } from "@/lib/fetch-cache";
import {
	ReviewScheduler,
	type SchedulerConfig,
	DEFAULT_SCHEDULER_CONFIG,
} from "@/lib/notification/review-scheduler";

interface ReviewReminderToggleProps {
	/** Callback when notification is clicked — typically triggers /review */
	onReviewFromNotification?: () => void;
}

export function ReviewReminderToggle({
	onReviewFromNotification,
}: ReviewReminderToggleProps) {
	const [enabled, setEnabled] = useState(false);
	const [permissionStatus, setPermissionStatus] = useState<
		"unsupported" | "granted" | "denied" | "default"
	>("default");
	const [showSettings, setShowSettings] = useState(false);
	const [config, setConfig] = useState<SchedulerConfig>(
		DEFAULT_SCHEDULER_CONFIG,
	);
	const [dailyNewLimit, setDailyNewLimit] = useState(10);
	const [dailyReviewLimit, setDailyReviewLimit] = useState(0);
	const [loading, setLoading] = useState(false);
	const nmRef = useRef<NotificationManager | null>(null);
	const onReviewRef = useRef(onReviewFromNotification);
	onReviewRef.current = onReviewFromNotification;

	// Initialize NotificationManager on mount
	useEffect(() => {
		const nm = NotificationManager.getInstance();
		nmRef.current = nm;
		nm.init().then(() => {
			const cfg = nm.getConfig();
			setConfig(cfg);
			setEnabled(cfg.enabled);
			setPermissionStatus(ReviewScheduler.getPermissionStatus());

			// Load daily limits from settings API
			cachedFetch<{ settings: Record<string, string> }>('/api/settings?prefix=review.')
				.then((data) => {
					const s = data.settings ?? {};
					setDailyNewLimit(
						parseInt(s["review.dailyNewLimit"] ?? "10", 10) || 0,
					);
					setDailyReviewLimit(
						parseInt(s["review.dailyReviewLimit"] ?? "0", 10) || 0,
					);
				})
				.catch(() => {});
		});

		// Listen for config changes
		const unsub = nm.onChange((newEnabled, newConfig) => {
			setEnabled(newEnabled);
			setConfig(newConfig);
			setPermissionStatus(ReviewScheduler.getPermissionStatus());
		});

		// Listen for notification clicks
		const handleNotificationClick = () => {
			onReviewRef.current?.();
		};
		window.addEventListener(
			"review-notification-click",
			handleNotificationClick,
		);

		return () => {
			unsub();
			window.removeEventListener(
				"review-notification-click",
				handleNotificationClick,
			);
		};
	}, []);

	const handleToggle = useCallback(async () => {
		if (loading) return;
		setLoading(true);
		try {
			const nm = nmRef.current;
			if (!nm) return;

			if (enabled) {
				// Turning off
				await nm.setEnabled(false);
			} else {
				// Turning on — request permission first
				const status = ReviewScheduler.getPermissionStatus();
				if (status === "denied") {
					// Can't enable — permission denied
					setPermissionStatus("denied");
					return;
				}
				await nm.setEnabled(true);
			}
		} finally {
			setLoading(false);
		}
	}, [enabled, loading]);

	const handleIntervalChange = useCallback(async (minutes: number) => {
		const nm = nmRef.current;
		if (!nm) return;
		await nm.updateConfig({ intervalMinutes: minutes });
	}, []);

	const handleQuietStartChange = useCallback(async (hour: number) => {
		const nm = nmRef.current;
		if (!nm) return;
		await nm.updateConfig({ quietHoursStart: hour });
	}, []);

	const handleQuietEndChange = useCallback(async (hour: number) => {
		const nm = nmRef.current;
		if (!nm) return;
		await nm.updateConfig({ quietHoursEnd: hour });
	}, []);

	const handleDailyNewLimitChange = useCallback(async (limit: number) => {
		setDailyNewLimit(limit);
		try {
			await fetch("/api/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					settings: { "review.dailyNewLimit": String(limit) },
				}),
			});
		} catch (err) {
			console.error(
				"[ReviewReminderToggle] Failed to save dailyNewLimit:",
				err,
			);
		}
	}, []);

	const handleDailyReviewLimitChange = useCallback(async (limit: number) => {
		setDailyReviewLimit(limit);
		try {
			await fetch("/api/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					settings: { "review.dailyReviewLimit": String(limit) },
				}),
			});
		} catch (err) {
			console.error(
				"[ReviewReminderToggle] Failed to save dailyReviewLimit:",
				err,
			);
		}
	}, []);

	// Determine visual state
	const isUnsupported = permissionStatus === "unsupported";
	const isDenied = permissionStatus === "denied";

	return (
		<div className="relative">
			<button
				type="button"
				onClick={handleToggle}
				disabled={loading || isUnsupported}
				className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
					enabled
						? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
						: "border-border bg-background text-foreground hover:bg-muted"
				}`}
				title={
					isUnsupported
						? "浏览器不支持通知"
						: isDenied
							? "通知权限已被拒绝，请在浏览器设置中开启"
							: enabled
								? "关闭复习提醒"
								: "开启复习提醒"
				}
			>
				{/* Bell icon — filled when enabled, outline when disabled */}
				{enabled ? (
					<svg className="size-3.5" fill="currentColor" viewBox="0 0 24 24">
						<path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
					</svg>
				) : (
					<svg
						className="size-3.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
						/>
					</svg>
				)}
			{enabled ? "提醒中" : "提醒"}
		</button>

			{/* Settings gear — only show when enabled */}
			{enabled && (
				<button
					type="button"
					onClick={() => setShowSettings((s) => !s)}
					className="ml-0.5 inline-flex items-center justify-center rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
					title="提醒设置"
				>
					<svg
						className="size-3"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
						/>
						<circle cx="12" cy="12" r="3" />
					</svg>
				</button>
			)}

			{/* Settings popover */}
			{showSettings && (
				<div className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border bg-popover p-3 shadow-lg z-50">
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium">提醒间隔</span>
							<select
								value={config.intervalMinutes}
								onChange={(e) =>
									handleIntervalChange(parseInt(e.target.value, 10))
								}
								className="h-7 rounded border bg-background px-2 text-xs"
							>
								<option value="15">15 分钟</option>
								<option value="30">30 分钟</option>
								<option value="60">1 小时</option>
								<option value="120">2 小时</option>
								<option value="240">4 小时</option>
							</select>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium">静默时段</span>
							<div className="flex items-center gap-1">
								<select
									value={config.quietHoursStart}
									onChange={(e) =>
										handleQuietStartChange(parseInt(e.target.value, 10))
									}
									className="h-7 rounded border bg-background px-2 text-xs"
								>
									{Array.from({ length: 24 }, (_, i) => (
										<option key={i} value={i}>
											{String(i).padStart(2, "0")}:00
										</option>
									))}
								</select>
								<span className="text-xs text-muted-foreground">—</span>
								<select
									value={config.quietHoursEnd}
									onChange={(e) =>
										handleQuietEndChange(parseInt(e.target.value, 10))
									}
									className="h-7 rounded border bg-background px-2 text-xs"
								>
									{Array.from({ length: 24 }, (_, i) => (
										<option key={i} value={i}>
											{String(i).padStart(2, "0")}:00
										</option>
									))}
								</select>
							</div>
						</div>
						{isDenied && (
							<p className="text-xs text-destructive">
								通知权限被拒绝，请在浏览器设置中允许通知
							</p>
						)}
						<div className="pt-2 border-t">
							<p className="text-xs font-medium mb-2">每日学习限额</p>
							<div className="flex items-center justify-between">
								<span className="text-xs text-muted-foreground">新词上限</span>
								<select
									value={dailyNewLimit}
									onChange={(e) =>
										handleDailyNewLimitChange(parseInt(e.target.value, 10))
									}
									className="h-7 rounded border bg-background px-2 text-xs"
								>
									<option value={0}>不限</option>
									<option value={5}>5</option>
									<option value={10}>10</option>
									<option value={15}>15</option>
									<option value={20}>20</option>
									<option value={30}>30</option>
									<option value={50}>50</option>
								</select>
							</div>
							<div className="flex items-center justify-between mt-1.5">
								<span className="text-xs text-muted-foreground">复习上限</span>
								<select
									value={dailyReviewLimit}
									onChange={(e) =>
										handleDailyReviewLimitChange(parseInt(e.target.value, 10))
									}
									className="h-7 rounded border bg-background px-2 text-xs"
								>
									<option value={0}>不限</option>
									<option value={20}>20</option>
									<option value={50}>50</option>
									<option value={100}>100</option>
									<option value={200}>200</option>
								</select>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
