'use client';

import React, { useState } from 'react';

interface MdxEntry { dict: string; text: string }

interface MdxDefinitionCardProps {
	type: 'mdx-found';
	word: string;
	entries: MdxEntry[];
	entryCount: number;
}

const DICT_LABELS: Record<string, string> = { oald: '牛津' };

export default function MdxDefinitionCard({ word, entries }: MdxDefinitionCardProps) {
	const [idx, setIdx] = useState(0);
	const entry = entries[idx];
	if (!entry) return null;

	return (
		<div style={{ margin: '8px 0', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 13, lineHeight: 1.6 }}>
			<div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid #e5e7eb', alignItems: 'center' }}>
				<span style={{ fontWeight: 600, marginRight: 8 }}>📖 {word}</span>
				{entries.map((e, i) => (
					<button key={e.dict} onClick={() => setIdx(i)} style={{
						padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12,
						background: i === idx ? '#3b82f6' : '#f3f4f6',
						color: i === idx ? '#fff' : '#374151',
					}}>{DICT_LABELS[e.dict] ?? e.dict}</button>
				))}
			</div>
			<div style={{ maxHeight: 400, overflowY: 'auto', padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
				{entry.text}
			</div>
			<div style={{ borderTop: '1px solid #e5e7eb', padding: '4px 12px', fontSize: 11, color: '#9ca3af' }}>
				{DICT_LABELS[entry.dict] ?? entry.dict} · {entries.length} 本词典
			</div>
		</div>
	);
}
