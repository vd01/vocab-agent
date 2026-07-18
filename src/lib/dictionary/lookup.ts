/**
 * Unified dictionary lookup — merges ECDICT (offline) + Free Dictionary API (online).
 *
 * Strategy:
 * - ECDICT provides: Chinese definitions, phonetics, frequency, exam tags, word forms
 * - API provides: English definitions with examples, synonyms/antonyms, audio URLs, etymology
 * - Sources are registered in priority order (API > ECDICT for phonetic; ECDICT fills gaps)
 * - Either source alone is sufficient to return a result
 */

import { mergeMultiple } from './merge';
import { registry } from './registry';
import { ecdictSource } from './ecdict';
import { freeDictSource } from './free-dict-api';
import { wordnetSource } from './wordnet';
import { wiktionarySource } from './wiktionary';
import { scanMdxSources } from './mdx/index';
import type { DictEntry } from './types';
export type { DictEntry, DefGroup, DictSource } from './types';

// ── Register sources at import time ──────────────────────────────────────

// FreeDict registered first so its IPA phonetic takes priority over ECDICT.
// For all other fields, ECDICT fills what the API does not provide.
// Wiktionary + WordNet provide additive data: etymology, synsets, relations.
// MDX sources are scanned and registered lazily on first lookup.
registry.register(freeDictSource);
registry.register(ecdictSource);
registry.register(wordnetSource);
registry.register(wiktionarySource);

// ── LRU Cache ────────────────────────────────────────────────────────────

const CACHE_MAX = 500;
const cache = new Map<string, DictEntry>();

function cacheGet(word: string) {
	const entry = cache.get(word);
	if (entry) {
		// Move to end (most recently used)
		cache.delete(word);
		cache.set(word, entry);
	}
	return entry;
}

function cacheSet(word: string, entry: DictEntry): void {
	if (cache.has(word)) cache.delete(word);
	cache.set(word, entry);
	if (cache.size > CACHE_MAX) {
		const firstKey = cache.keys().next().value;
		if (firstKey) cache.delete(firstKey);
	}
}

// ── Public API ───────────────────────────────────────────────────────────

let mdxSourcesRegistered = false;

async function ensureMdxRegistered(): Promise<void> {
	if (mdxSourcesRegistered) return;
	try {
		const sources = await scanMdxSources();
		for (const source of sources) {
			registry.register(source);
		}
		mdxSourcesRegistered = true;
	} catch {
		// MDX is optional; silently skip
	}
}

/**
 * Look up a word from all available dictionary sources.
 * Results are cached in memory (LRU, max 500 entries).
 */
export async function lookupWord(word: string) {
	const normalized = word.toLowerCase().trim();

	await ensureMdxRegistered();

	const cached = cacheGet(normalized);
	if (cached) return cached;

	const results = await registry.lookupAll(normalized);
	const entry = mergeMultiple(results);
	if (entry) cacheSet(normalized, entry);

	return entry;
}

/**
 * Look up a word from ECDICT only (offline, no network).
 */
export async function lookupWordOffline(word: string) {
	const normalized = word.toLowerCase().trim();

	const cached = cacheGet(normalized);
	if (cached && (cached.source === 'ecdict' || cached.source === 'both')) return cached;

	const results = await Promise.all([
		ecdictSource.available().then((ok) => (ok ? ecdictSource.lookup(normalized) : null)),
	]);
	const entry = mergeMultiple(results);
	if (entry) cacheSet(normalized, entry);

	return entry;
}
