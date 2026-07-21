"use client";

import { ChatPanel } from "@/components/chat/chat-panel";
import { PinnedSidebar } from "@/components/pinned/pinned-sidebar";
import { GroupProvider } from "@/lib/groups/group-context";
import { GroupSelector } from "@/components/groups/group-selector";
import { useState, useEffect } from "react";
import Link from "next/link";

export default function Home() {
	const [pinRefreshKey, setPinRefreshKey] = useState(0);

	useEffect(() => {
		const onPinChange = () => setPinRefreshKey((k) => k + 1);
		window.addEventListener("pin-change", onPinChange);

		// Refresh when returning from another window (e.g. Tauri quick-lookup)
		// but with a 10s cooldown to avoid redundant refreshes on normal tab switching
		let lastRefresh = 0;
		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				const now = Date.now();
				if (now - lastRefresh > 10_000) {
					lastRefresh = now;
					setPinRefreshKey((k) => k + 1);
				}
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			window.removeEventListener("pin-change", onPinChange);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	return (
		<GroupProvider>
			<div className="flex h-screen bg-background">
				<PinnedSidebar side="left" refreshKey={pinRefreshKey} />
				<div className="flex flex-col flex-1 min-w-0">
					<header className="border-b px-4 py-2.5 flex items-center justify-center shrink-0 relative">
						<div className="absolute left-4 top-1/2 -translate-y-1/2">
							<GroupSelector />
						</div>
						<h1 className="text-sm font-medium text-foreground">Vocab Agent</h1>
						<div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1">
							<ThemeToggle />
							<Link
								href="/settings"
								className="text-muted-foreground hover:text-foreground transition-colors"
								title="设置"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
									<circle cx="12" cy="12" r="3" />
								</svg>
							</Link>
						</div>
					</header>
					<main className="flex-1 overflow-hidden">
						<ChatPanel />
					</main>
				</div>
				<PinnedSidebar side="right" refreshKey={pinRefreshKey} />
			</div>
		</GroupProvider>
	);
}

// Inline theme toggle to avoid SSR/hydration issues with context
function ThemeToggle() {
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const toggleTheme = () => {
		const root = document.documentElement;
		const isDark = root.classList.contains('dark');
		if (isDark) {
			root.classList.remove('dark');
			try { localStorage.setItem('vocab-agent-theme', 'light'); } catch {}
		} else {
			root.classList.add('dark');
			try { localStorage.setItem('vocab-agent-theme', 'dark'); } catch {}
		}
	};

	// Don't render until mounted to avoid hydration mismatch
	if (!mounted) {
		return (
			<span className="inline-flex items-center justify-center rounded-lg p-1.5 text-muted-foreground">
				<svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
				</svg>
			</span>
		);
	}

	return (
		<button
			onClick={toggleTheme}
			className="inline-flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
			title="切换主题"
			aria-label="切换主题"
		>
			<svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
			</svg>
		</button>
	);
}
