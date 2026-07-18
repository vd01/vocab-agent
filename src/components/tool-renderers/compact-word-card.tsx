"use client";

/**
 * Compact word card for carousel display
 * Extracted from message-item.tsx
 */

import React from "react";
import { PronounceButton } from "@/components/vocab/pronounce-button";

export interface CompactWordCardItem {
	word: string;
	phonetic: string | null;
	audioUrl: string | null;
	definition: string | null;
	wordId: string;
	tag: string | null;
	collins: number | null;
}

export function CompactWordCard({ item }: { item: CompactWordCardItem }) {
	return (
		<div className="rounded-lg bg-white dark:bg-muted/50 p-2.5 space-y-1">
			<div className="flex items-baseline gap-1.5 flex-wrap">
				<span className="font-semibold text-sm">{item.word}</span>
				{item.phonetic && (
					<span className="text-xs text-muted-foreground">{item.phonetic}</span>
				)}
				<PronounceButton word={item.word} audioUrl={item.audioUrl} />
				{item.collins && (
					<span className="text-amber-500 text-[10px]">
						{"★".repeat(item.collins)}
					</span>
				)}
				{item.tag && (
					<span className="text-[10px] px-1 py-0 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
						{item.tag.split(/\s+/)[0]}
					</span>
				)}
			</div>
			{item.definition && (
				<div className="text-xs text-muted-foreground line-clamp-2">
					{item.definition.split("\n")[0]}
				</div>
			)}
		</div>
	);
}
