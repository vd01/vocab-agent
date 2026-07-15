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
		return () => window.removeEventListener("pin-change", onPinChange);
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
						<Link
							href="/settings"
							className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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
