"use client";

/**
 * BatchAddResult — carousel of added words from batch-add-words tool
 * Extracted from message-item.tsx
 */

import React, { useState } from "react";
import { CompactWordCard } from "./compact-word-card";

export function BatchAddResult({ output }: { output: any }) {
	const addedItems = (output.results ?? []).filter(
		(r: any) => r.type === "added",
	);
	const errorItems = (output.results ?? []).filter(
		(r: any) => r.type === "error",
	);
	const skippedItems = (output.results ?? []).filter(
		(r: any) => r.type === "already-exists",
	);
	const [currentIndex, setCurrentIndex] = useState(0);

	const goTo = (idx: number) => {
		setCurrentIndex(Math.max(0, Math.min(idx, addedItems.length - 1)));
	};

	return (
		<div className="mt-2 rounded-xl border border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20 overflow-hidden">
			<div className="flex items-center justify-between px-3 py-2">
				<div className="flex items-center gap-2">
					<svg
						className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<span className="text-sm font-medium text-green-700 dark:text-green-300">
						{output.message}
					</span>
				</div>
				{addedItems.length > 1 && (
					<span className="text-xs text-muted-foreground">
						{currentIndex + 1} / {addedItems.length}
					</span>
				)}
			</div>

			{addedItems.length > 0 && (
				<>
					{addedItems.length === 1 ? (
						<div className="px-3 pb-2">
							<CompactWordCard item={addedItems[0]} />
						</div>
					) : (
						<div className="relative">
							{currentIndex > 0 && (
								<button
									type="button"
									onClick={() => goTo(currentIndex - 1)}
									className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/80 dark:bg-muted/80 shadow-sm flex items-center justify-center hover:bg-white dark:hover:bg-muted transition-colors"
								>
									<svg
										className="w-4 h-4"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										strokeWidth={2}
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											d="M15 19l-7-7 7-7"
										/>
									</svg>
								</button>
							)}
							{currentIndex < addedItems.length - 1 && (
								<button
									type="button"
									onClick={() => goTo(currentIndex + 1)}
									className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/80 dark:bg-muted/80 shadow-sm flex items-center justify-center hover:bg-white dark:hover:bg-muted transition-colors"
								>
									<svg
										className="w-4 h-4"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										strokeWidth={2}
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											d="M9 5l7 7-7 7"
										/>
									</svg>
								</button>
							)}
							<div className="px-3 pb-2">
								<CompactWordCard item={addedItems[currentIndex]} />
							</div>
							<div className="flex justify-center gap-1 pb-2">
								{addedItems.map((_: any, idx: number) => (
									<button
										key={idx}
										type="button"
										onClick={() => goTo(idx)}
										className={`w-1.5 h-1.5 rounded-full transition-colors ${
											idx === currentIndex
												? "bg-green-500"
												: "bg-green-300 dark:bg-green-800"
										}`}
									/>
								))}
							</div>
						</div>
					)}
				</>
			)}

			{errorItems.length > 0 && (
				<div className="px-3 pb-2 space-y-0.5">
					{errorItems.map((item: any, i: number) => (
						<div key={i} className="text-xs text-red-500">
							{item.message}
						</div>
					))}
				</div>
			)}

			{skippedItems.length > 0 && (
				<details className="px-3 pb-2">
					<summary className="text-xs text-muted-foreground cursor-pointer">
						{skippedItems.length} 个词已在词库中
					</summary>
					<div className="mt-1 flex flex-wrap gap-1">
						{skippedItems.map((item: any, i: number) => (
							<span key={i} className="text-xs bg-muted rounded px-1.5 py-0.5">
								{item.word}
							</span>
						))}
					</div>
				</details>
			)}
		</div>
	);
}
