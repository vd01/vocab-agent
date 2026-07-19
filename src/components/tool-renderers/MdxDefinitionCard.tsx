'use client';

import React, { useState } from 'react';

interface MdxEntry {
	dict: string;
	text: string;
}

interface MdxDefinitionCardProps {
	type: 'mdx-found';
	word: string;
	entries: MdxEntry[];
	entryCount: number;
}

const DICT_LABELS: Record<string, string> = {
	oald: '牛津',
	ldoce: '朗文',
	merriam: '韦氏',
};

function dictLabel(id: string): string {
	return DICT_LABELS[id] ?? id;
}

/** Clean HTML leftovers and normalize whitespace. */
function cleanText(raw: string): string {
	return raw
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

/** Split text into segments: numbered definitions and examples. */
function segmentText(text: string): Array<{ type: 'def' | 'example'; text: string }> {
	const lines = text.split(/\n(?=\d+\.?\s)/);
	return lines
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const isExample = line.includes('—') || line.includes('…');
			return {
				type: isExample ? ('example' as const) : ('def' as const),
				text: line,
			};
		});
}

export default function MdxDefinitionCard({ word, entries }: MdxDefinitionCardProps) {
	const [activeIdx, setActiveIdx] = useState(0);
	const activeDict = entries[activeIdx]?.dict ?? '';
	const activeEntry = entries[activeIdx];

	if (entries.length === 0) {
		return (
			<div className="p-3 text-sm text-muted-foreground">
				未找到 &quot;{word}&quot; 的释义
			</div>
		);
	}

	const segments = activeEntry ? segmentText(cleanText(activeEntry.text)) : [];

	return (
		<div className="my-2 rounded-lg border bg-card text-card-foreground shadow-sm">
			{/* Header */}
			<div className="flex items-center gap-1 border-b px-3 py-2">
				<span className="mr-2 text-sm font-semibold">📖 {word}</span>
				{entries.map((entry, i) => (
					<button
						key={entry.dict}
						onClick={() => setActiveIdx(i)}
						className={`rounded px-2 py-0.5 text-xs transition-colors ${
							i === activeIdx
								? 'bg-primary text-primary-foreground'
								: 'bg-muted hover:bg-muted-foreground/20'
						}`}
					>
						{dictLabel(entry.dict)}
					</button>
				))}
			</div>

			{/* Body */}
			<div className="max-h-96 overflow-y-auto px-3 py-2 text-sm leading-relaxed">
				{segments.length > 0 ? (
					<ul className="list-none space-y-1.5">
						{segments.map((seg, i) => (
							<li
								key={i}
								className={`pl-1 ${
									seg.type === 'example'
										? 'ml-4 text-muted-foreground italic'
										: ''
								}`}
							>
								{seg.type === 'def' && (
									<span className="mr-1 font-medium text-foreground/60">
										•
									</span>
								)}
								{seg.text}
							</li>
						))}
					</ul>
				) : (
					<p className="text-muted-foreground">{cleanText(activeEntry.text)}</p>
				)}
			</div>

			{/* Footer */}
			<div className="border-t px-3 py-1 text-xs text-muted-foreground">
				{dictLabel(activeDict)} · {entries.length} 本词典
			</div>
		</div>
	);
}
