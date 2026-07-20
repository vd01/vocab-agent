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
import { wordDebugger } from '../debug/word-debug';
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
	if (cached) {
		// Record cached result for debugging if tracking
		if (wordDebugger.isTracking(normalized)) {
			wordDebugger.recordSource(normalized, 'cache', cached, 0);
		}
		return cached;
	}

	// Debug: start tracking and record per-source results with timing
	const isTracking = wordDebugger.isTracking(normalized);
	const sources = registry.getSources();
	const timedResults = await Promise.all(
		sources.map(async (s) => {
			const start = Date.now();
			try {
				const result = await s.lookup(normalized);
				const durationMs = Date.now() - start;
				if (isTracking) {
					wordDebugger.recordSource(normalized, s.name, result, durationMs);
				}
				return result;
			} catch {
				const durationMs = Date.now() - start;
				if (isTracking) {
					wordDebugger.recordSource(normalized, s.name, null, durationMs);
				}
				return null;
			}
		}),
	);

	const entry = mergeMultiple(timedResults);
	if (entry) cacheSet(normalized, entry);

	// Debug: record merged result
	if (isTracking) {
		wordDebugger.recordMerged(normalized, entry);
	}

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
		ecdictSource.lookup(normalized),
	]);
	const entry = mergeMultiple(results);
	if (entry) cacheSet(normalized, entry);

	return entry;
}

/**
 * Fast lookup for quick-lookup window — ECDICT first, everything else async.
 *
 * Returns a tuple: [fastEntry, backgroundPromise]
 * - fastEntry: result from ECDICT only (SQLite, ~10ms). Sufficient for
 *   Chinese translation, phonetic, frequency, exam tags.
 * - backgroundPromise: resolves after WordNet + MDX + FreeDict + Wiktionary
 *   complete. Caches the enriched entry for future lookups.
 *
 * The caller should use fastEntry immediately and ignore backgroundPromise
 * (it only serves to warm the cache).
 */
export async function lookupWordFast(
	word: string,
): Promise<[DictEntry | null, Promise<DictEntry | null>]> {
	const normalized = word.toLowerCase().trim();

	const cached = cacheGet(normalized);
	if (cached) {
		if (wordDebugger.isTracking(normalized)) {
			wordDebugger.recordSource(normalized, 'cache', cached, 0);
		}
		return [cached, Promise.resolve(cached)];
	}

	// Phase 1: ECDICT only — SQLite direct query, ~10ms
	const ecdictStart = Date.now();
	const ecdictResult = await ecdictSource.lookup(normalized);
	const ecdictMs = Date.now() - ecdictStart;
	if (wordDebugger.isTracking(normalized)) {
		wordDebugger.recordSource(normalized, 'ecdict', ecdictResult, ecdictMs);
	}
	const fastEntry = mergeMultiple([ecdictResult]);

	// Phase 2: all other sources in background — WordNet (slow first load),
	// MDX, FreeDict, Wiktionary — none block the response
	const isTracking = wordDebugger.isTracking(normalized);
	const backgroundPromise = (async (): Promise<DictEntry | null> => {
		await ensureMdxRegistered();

		const otherSources = [
			{ name: 'wordnet', fn: () => wordnetSource.lookup(normalized) },
			...registry
				.getSources()
				.filter((s) => s.name.startsWith('mdx:'))
				.map((s) => ({ name: s.name, fn: () => s.lookup(normalized) })),
			{ name: 'free-dict-api', fn: () => freeDictSource.lookup(normalized) },
			{ name: 'wiktionary', fn: () => wiktionarySource.lookup(normalized) },
		];

		const otherResults = await Promise.all(
			otherSources.map(async ({ name, fn }) => {
				const start = Date.now();
				try {
					const result = await fn();
					const ms = Date.now() - start;
					if (isTracking) wordDebugger.recordSource(normalized, name, result, ms);
					return result;
				} catch {
					const ms = Date.now() - start;
					if (isTracking) wordDebugger.recordSource(normalized, name, null, ms);
					return null;
				}
			}),
		);

		const allResults = [ecdictResult, ...otherResults];
		const fullEntry = mergeMultiple(allResults);
		if (fullEntry) cacheSet(normalized, fullEntry);

		if (isTracking) wordDebugger.recordMerged(normalized, fullEntry);

		return fullEntry;
	})();

	return [fastEntry, backgroundPromise];
}
