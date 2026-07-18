"use client";

/**
 * BatchAddedWords — collapsed carousel of added words
 * Extracted from message-item.tsx
 */

import React, { useState } from "react";
import { CompactWordCard, type CompactWordCardItem } from "./compact-word-card";

export interface BatchAddedWordsItem extends CompactWordCardItem {
	examples: any;
	message: string;
}

export function BatchAddedWords({ items }: { items: BatchAddedWordsItem[] }) {
	const [currentIndex, setCurrentIndex] = useState(0);

	const goTo = (idx: number) => {
		const clamped = Math.max(0, Math.min(idx, items.length - 1));
		setCurrentIndex(clamped);
	};

	const item = items[currentIndex];

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
						已添加 {items.length} 个单词
					</span>
				</div>
				{items.length > 1 && (
					<span className="text-xs text-muted-foreground">
						{currentIndex + 1} / {items.length}
					</span>
				)}
			</div>

			{items.length === 1 ? (
				<div className="px-3 pb-2">
					<CompactWordCard item={items[0]} />
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
					{currentIndex < items.length - 1 && (
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
						<CompactWordCard item={item} />
					</div>
					{items.length > 1 && (
						<div className="flex justify-center gap-1 pb-2">
							{items.map((_, idx) => (
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
					)}
				</div>
			)}
		</div>
	);
}
