/**
 * Wiktionary unified lookup — offline-first with REST fallback.
 *
 * Phase B (REST): online-only lookup via wiktionaryRestLookup.
 * Phase C (offline): checks data/wiktionary.db first, REST for long-tail words,
 * caching REST results to SQLite for future offline access.
 */

import { createClient } from '@libsql/client';
import path from 'path';
import { wiktionaryRestLookup } from './wiktionary-rest';
import type { DictEntry, DictSource } from './types';

// ── SQLite layer ─────────────────────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), 'data', 'wiktionary.db');

let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
	if (!_client) {
		_client = createClient({ url: `file:${DB_PATH}` });
	}
	return _client;
}

interface WiktionaryRow {
	word: string;
	pos: string;
	etymology: string | null;
	forms: string | null;  // JSON
	sounds: string | null; // JSON
	senses: string | null; // JSON
}

async function offlineLookup(word: string): Promise<WiktionaryRow | null> {
	try {
		const client = getClient();
		const result = await client.execute({
			sql: 'SELECT * FROM wiktionary WHERE word = ? COLLATE NOCASE',
			args: [word],
		});
		if (result.rows.length === 0) return null;
		const row = result.rows[0];
		return {
			word: row.word as string,
			pos: (row.pos as string) || '',
			etymology: (row.etymology as string) || null,
			forms: (row.forms as string) || null,
			sounds: (row.sounds as string) || null,
			senses: (row.senses as string) || null,
		};
	} catch {
		return null;
	}
}

async function cacheToOffline(word: string, data: WiktionaryRow): Promise<void> {
	try {
		const client = getClient();
		await client.execute({
			sql: `INSERT OR REPLACE INTO wiktionary (word, pos, etymology, forms, sounds, senses) VALUES (?, ?, ?, ?, ?, ?)`,
			args: [
				word,
				data.pos,
				data.etymology,
				data.forms,
				data.sounds,
				data.senses,
			],
		});
	} catch {
		// Silently ignore cache write failures
	}
}

// ── Conversion ───────────────────────────────────────────────────────────

function rowToDictEntry(
	word: string,
	row: WiktionaryRow,
): Partial<DictEntry> {
	const senses: Array<{ glosses?: string[]; examples?: Array<{ text?: string }>; tags?: string[] }> =
		row.senses ? JSON.parse(row.senses) : [];
	const sounds: Array<{ ipa?: string; audio?: string; tags?: string[] }> =
		row.sounds ? JSON.parse(row.sounds) : [];
	const forms: Array<{ form?: string; tags?: string[] }> =
		row.forms ? JSON.parse(row.forms) : [];

	// Build DefGroup from senses
	const defGroups = senses.map((s) => ({
		partOfSpeech: row.pos || '',
		definitions: (s.glosses ?? []).map((g) => ({
			definition: g,
		})),
	}));

	return {
		word,
		definitions: defGroups,
		etymology: row.etymology ?? undefined,
		forms: forms.map((f) => ({ form: f.form ?? '', tags: f.tags ?? [] })),
		ipa: sounds.map((s) => ({ ipa: s.ipa ?? '', audio: s.audio, tag: s.tags?.[0] })),
		source: 'wiktionary',
	};
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Look up a word from Wiktionary — offline DB first, REST fallback.
 * REST results are cached to the offline DB for future queries.
 */
export async function wiktionaryLookup(
	word: string,
): Promise<Partial<DictEntry> | null> {
	const normalized = word.toLowerCase().trim();

	// 1. Try offline DB
	const offline = await offlineLookup(normalized);
	if (offline) {
		return rowToDictEntry(normalized, offline);
	}

	// 2. Fallback to REST
	const restEntry = await wiktionaryRestLookup(normalized);
	if (!restEntry) return null;

	// Convert REST result to DictEntry format and cache
	const defGroups = restEntry.definitions.map((g) => ({
		partOfSpeech: g.partOfSpeech,
		definitions: g.definitions.map((d) => ({
			definition: d.definition,
			...('examples' in d && d.examples?.[0]
				? { example: d.examples?.[0] }
				: {}),
		})),
	}));

	// Cache REST result to offline DB
	const cacheRow: WiktionaryRow = {
		word: normalized,
		pos: restEntry.definitions[0]?.partOfSpeech ?? '',
		etymology: restEntry.etymology ?? null,
		forms: restEntry.forms ? JSON.stringify(restEntry.forms) : null,
		sounds: restEntry.ipa ? JSON.stringify([{ ipa: restEntry.ipa }]) : null,
		senses: restEntry.definitions.length > 0
			? JSON.stringify(restEntry.definitions.map((g) => ({
					glosses: g.definitions.map((d) => d.definition),
					examples: g.definitions
						.filter((d) => 'examples' in d && d.examples?.length)
						.map((d) => ({ text: d.examples?.[0] })),
				})))
			: null,
	};
	cacheToOffline(normalized, cacheRow).catch(() => { /* noop */ });

	return {
		word: restEntry.word,
		definitions: defGroups,
		etymology: restEntry.etymology ?? undefined,
		forms: restEntry.forms ?? undefined,
		ipa: restEntry.ipa ? [{ ipa: restEntry.ipa }] : undefined,
		source: 'wiktionary',
	};
}

// ── Source adapter ───────────────────────────────────────────────────────

/**
 * DictSource adapter for Wiktionary.
 * Provides definitions, etymology, forms, and IPA — additive data.
 */
export const wiktionarySource: DictSource = {
	name: 'wiktionary',
	available: async () => {
		// Available if we have offline DB OR REST API is expected to work
		try {
			const client = getClient();
			const result = await client.execute('SELECT COUNT(*) as cnt FROM wiktionary');
			if (Number(result.rows[0].cnt) > 0) return true;
		} catch {
			// DB not present, rely on REST
		}
		return true; // REST always available (network-dependent)
	},
	lookup: wiktionaryLookup,
};
