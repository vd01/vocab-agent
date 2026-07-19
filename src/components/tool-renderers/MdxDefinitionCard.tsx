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

function cleanText(raw: string): string {
	return raw
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\r\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export default function MdxDefinitionCard({ word, entries }: MdxDefinitionCardProps) {
	const [activeIdx, setActiveIdx] = useState(0);
	const activeEntry = entries[activeIdx];

	if (entries.length === 0) {
		return (
			<div style={{ padding: 12, fontSize: 14, color: '#888' }}>
				未找到 &quot;{word}&quot; 的释义
			</div>
		);
	}

	return (
		<div style={{
			margin: '8px 0',
			borderRadius: 8,
			border: '1px solid #e5e7eb',
			background: '#fff',
			fontSize: 14,
			lineHeight: 1.6,
		}}>
			{/* Tabs */}
			<div style={{
				display: 'flex',
				gap: 4,
				padding: '8px 12px',
				borderBottom: '1px solid #e5e7eb',
				alignItems: 'center',
			}}>
				<span style={{ fontWeight: 600, marginRight: 8 }}>📖 {word}</span>
				{entries.map((entry, i) => (
					<button
						key={entry.dict}
						onClick={() => setActiveIdx(i)}
						style={{
							padding: '2px 8px',
							borderRadius: 4,
							border: 'none',
							cursor: 'pointer',
							fontSize: 12,
							background: i === activeIdx ? '#3b82f6' : '#f3f4f6',
							color: i === activeIdx ? '#fff' : '#374151',
						}}
					>
						{dictLabel(entry.dict)}
					</button>
				))}
			</div>

			{/* Body */}
			<div style={{
				maxHeight: 400,
				overflowY: 'auto',
				padding: '12px',
				whiteSpace: 'pre-wrap',
				wordBreak: 'break-word',
				fontSize: 13,
			}}>
				{activeEntry ? cleanText(activeEntry.text) : '无内容'}
			</div>

			{/* Footer */}
			<div style={{
				borderTop: '1px solid #e5e7eb',
				padding: '4px 12px',
				fontSize: 11,
				color: '#9ca3af',
			}}>
				{dictLabel(activeEntry?.dict ?? '')} · {entries.length} 本词典
			</div>
		</div>
	);
}
