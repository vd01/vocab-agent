/**
 * MdxSource — DictSource adapter for MDX dictionary files.
 *
 * Scans data/mdx/*.mdx, wraps each file as a DictSource.
 * Uses mdict-js (MIT) for parsing. Cache lives on globalThis to survive HMR.
 *
 * MDX content is lazily returned — not included in merge pipeline.
 * Use the standalone mdx-lookup tool for full HTML definitions.
 */

import type { DictSource, DictEntry } from '../types';
import path from 'path';
import { existsSync, readdirSync } from 'fs';

// ── Types ────────────────────────────────────────────────────────────────

interface MdictFile {
	lookup(word: string): { definition?: string; html?: string; text?: string } | null;
	keys(): string[];
}

// ── Constants ────────────────────────────────────────────────────────────

const MDX_DIR = path.join(process.cwd(), 'data', 'mdx');

/** Chinese filename → short canonical ID mapping. */
const DICT_ID_MAP: Record<string, string> = {
	'新牛津英汉双解大词典': 'oald',
	'朗文当代英语词典英汉双解词典': 'ldoce',
	'韦氏高阶学习词典': 'merriam',
};

function deriveDictId(filename: string): string {
	const base = path.basename(filename, '.mdx');
	return DICT_ID_MAP[base] ?? base.toLowerCase().replace(/\s+/g, '-');
}

// ── Log noise suppression ────────────────────────────────────────────────

/** Suppress mdict-js internal console.log during ops. */
function withSilentConsole<T>(fn: () => T): T {
	const orig = console.log;
	console.log = () => {};
	try {
		return fn();
	} finally {
		console.log = orig;
	}
}

// ── Loader ───────────────────────────────────────────────────────────────

/** Load an MDX file using mdict-js. Returns null on failure. */
async function loadMdxFile(filePath: string): Promise<MdictFile | null> {
	return withSilentConsole(async () => {
		try {
			const module = await import('mdict-js');
			const Mdict = module.default;
			const mdict = new Mdict(filePath);

			return {
				lookup(word: string) {
					return withSilentConsole(() => {
						try {
							const result = mdict.lookup(word);
							if (!result) return null;
							let text = '';
							let html = '';
							try {
								text = (mdict.parse_defination as ((def: string) => string))(result.definition);
								html = result.definition ?? '';
							} catch {
								html = result.definition ?? '';
							}
							return {
								definition: result.definition,
								html: html || result.definition || '',
								text: text || result.definition || '',
							};
						} catch {
							return null;
						}
					});
				},
				keys() {
					return withSilentConsole(() => {
						try {
							const k = ((mdict as unknown) as Record<string, unknown>).keys as
								| (() => string[])
								| undefined;
							return k?.call(mdict) ?? [];
						} catch {
							return [];
						}
					});
				},
			};
		} catch {
			return null;
		}
	});
}

// ── HMR-surviving cache (globalThis) ─────────────────────────────────────

const CACHE_KEY = Symbol.for('vocab-agent:mdx-sources');

interface MdxCache {
	sources: DictSource[] | null;
	loadPromise: Promise<DictSource[]> | null;
}

function getCache(): MdxCache {
	const g = globalThis as Record<symbol, MdxCache>;
	if (!g[CACHE_KEY]) {
		g[CACHE_KEY] = { sources: null, loadPromise: null };
	}
	return g[CACHE_KEY];
}

// ── Source factory ───────────────────────────────────────────────────────

/**
 * Scan data/mdx/ for *.mdx files and create a DictSource for each.
 * Cache survives HMR reloads via globalThis.
 */
export async function scanMdxSources(): Promise<DictSource[]> {
	const cache = getCache();
	if (cache.sources !== null) return cache.sources;
	if (cache.loadPromise !== null) return cache.loadPromise;

	cache.loadPromise = (async () => {
		const sources: DictSource[] = [];

		if (!existsSync(MDX_DIR)) {
			cache.sources = sources;
			return sources;
		}

		const entries = readdirSync(MDX_DIR);
		for (const entry of entries) {
			if (!entry.endsWith('.mdx')) continue;

			const dictId = deriveDictId(entry);
			const filePath = path.join(MDX_DIR, entry);

			const mdict = await loadMdxFile(filePath);
			if (!mdict) continue;

			sources.push({
				name: `mdx:${dictId}`,
				available: async () => existsSync(filePath),
				lookup: async (word: string) => {
					const result = mdict.lookup(word);
					if (!result) return null;

					const mdxEntries: DictEntry['mdxEntries'] = [
						{
							dict: dictId,
							html: result.html || '',
							text: result.text || '',
						},
					];

					return {
						word,
						translation: (result.text || result.definition || '').slice(0, 200),
						mdxEntries,
						source: `mdx:${dictId}`,
					};
				},
			});
		}

		cache.sources = sources;
		console.log(`[mdx] Loaded ${sources.length} dictionary(s): ${sources.map(s => s.name).join(', ')}`);
		return sources;
	})();

	return cache.loadPromise;
}

/**
 * Look up a word across all registered MDX sources.
 */
export async function mdxLookupAll(
	word: string,
): Promise<Array<{ dict: string; html: string; text: string }>> {
	const sources = await scanMdxSources();
	const results: Array<{ dict: string; html: string; text: string }> = [];

	for (const source of sources) {
		try {
			const result = await source.lookup(word);
			if (result?.mdxEntries) {
				for (const entry of result.mdxEntries) {
					results.push(entry);
				}
			}
		} catch {
			// Skip failed sources
		}
	}

	return results;
}
