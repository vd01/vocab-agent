/**
 * MdxSource — DictSource adapter for MDX dictionary files.
 *
 * Scans data/mdx/*.mdx, extracts plain text definitions, feeds LLM.
 * No HTML rendering, no MDD resource handling — just text.
 */

import type { DictSource, DictEntry } from '../types';
import path from 'path';
import { existsSync, readdirSync } from 'fs';

// ── Constants ────────────────────────────────────────────────────────────

const MDX_DIR = path.join(process.cwd(), 'data', 'mdx');

const DICT_ID_MAP: Record<string, string> = {
	'牛津高阶英汉双解词典（第9版）': 'oald',
};

function deriveDictId(filename: string): string {
	const base = path.basename(filename, '.mdx');
	return DICT_ID_MAP[base] ?? base;
}

// ── Log suppression ──────────────────────────────────────────────────────

function noConsole<T>(fn: () => T): T {
	const orig = console.log;
	console.log = () => {};
	try { return fn(); } finally { console.log = orig; }
}

// ── Loader ───────────────────────────────────────────────────────────────

async function loadMdxFile(filePath: string, dictId: string): Promise<DictSource | null> {
	return noConsole(async () => {
		try {
			const { MDX } = await import('js-mdict');
			const mdict = new MDX(filePath);

			return {
				name: `mdx:${dictId}`,
				available: async () => existsSync(filePath),
				lookup: async (word: string) => {
					return noConsole(() => {
						try {
							const result = mdict.lookup(word);
							if (!result?.definition) return null;

							// Strip HTML → plain text
							const text = result.definition
								.replace(/<[^>]*>/g, '')
								.replace(/&nbsp;/g, ' ')
								.replace(/&amp;/g, '&')
								.replace(/&lt;/g, '<')
								.replace(/&gt;/g, '>')
								.replace(/&quot;/g, '"')
								.replace(/\s+/g, ' ')
								.trim();

							return {
								word,
								// Use mdxEntries (dedicated field) to preserve full content
								// without truncation or colliding with ECDICT's translation
								mdxEntries: [{ dict: dictId, html: result.definition, text }],
								source: `mdx:${dictId}`,
							};
						} catch {
							return null;
						}
					});
				},
			};
		} catch {
			return null;
		}
	});
}

// ── HMR-surviving cache ──────────────────────────────────────────────────

const CACHE_KEY = Symbol.for('vocab-agent:mdx-sources');

interface MdxCache {
	sources: DictSource[] | null;
	loadPromise: Promise<DictSource[]> | null;
}

function getCache(): MdxCache {
	const g = globalThis as Record<symbol, MdxCache>;
	if (!g[CACHE_KEY]) g[CACHE_KEY] = { sources: null, loadPromise: null };
	return g[CACHE_KEY];
}

// ── Public API ───────────────────────────────────────────────────────────

export async function scanMdxSources(): Promise<DictSource[]> {
	const cache = getCache();
	if (cache.sources !== null) return cache.sources;
	if (cache.loadPromise !== null) return cache.loadPromise;

	cache.loadPromise = (async () => {
		const sources: DictSource[] = [];
		if (!existsSync(MDX_DIR)) { cache.sources = sources; return sources; }

		for (const entry of readdirSync(MDX_DIR)) {
			if (!entry.endsWith('.mdx')) continue;
			const dictId = deriveDictId(entry);
			const src = await loadMdxFile(path.join(MDX_DIR, entry), dictId);
			if (src) sources.push(src);
		}

		cache.sources = sources;
		console.log(`[mdx] Loaded ${sources.length} dict(s): ${sources.map(s => s.name).join(', ')}`);
		return sources;
	})();

	return cache.loadPromise;
}

export async function mdxLookupAll(word: string): Promise<Array<{ dict: string; text: string }>> {
	const sources = await scanMdxSources();
	const results: Array<{ dict: string; text: string }> = [];
	for (const src of sources) {
		try {
			const r = await src.lookup(word);
			if (r?.translation) results.push({ dict: src.name.replace('mdx:', ''), text: r.translation });
		} catch { /* skip */ }
	}
	return results;
}
