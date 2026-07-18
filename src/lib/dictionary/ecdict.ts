/**
 * ECDICT offline dictionary — read-only query wrapper for data/ecdict.db
 *
 * The database is populated by `npm run import-ecdict` from ECDICT/ecdict.csv.
 * This module only reads; it never writes.
 */

import { createClient, type Client } from '@libsql/client';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'ecdict.db');

let _client: Client | null = null;

/** ECDICT CSV stores newlines as literal \\n — convert to real newlines */
function unescapeNewlines(val: string | null | undefined): string | null {
  if (!val) return null;
  return val.replace(/\\n/g, '\n');
}

function getClient(): Client {
  if (!_client) {
    _client = createClient({ url: `file:${DB_PATH}` });
  }
  return _client;
}

export interface EcdictEntry {
  word: string;
  phonetic: string | null;
  definition: string | null;     // English definitions (newline-separated)
  translation: string | null;    // Chinese definitions (newline-separated)
  pos: string | null;            // Part of speech
  collins: number | null;        // Collins star rating 1-5
  oxford: number | null;         // Oxford 3000 core word flag
  tag: string | null;            // Exam tags: "cet4 cet6 gre toefl"
  bnc: number | null;            // BNC frequency rank
  frq: number | null;            // Contemporary corpus frequency rank
  exchange: string | null;       // Inflected forms: "d:abandoned/p:abandoned/i:abandoning/3:abandons"
}

/**
 * Look up a word in ECDICT. Returns null if not found or DB doesn't exist.
 */
export async function ecdictLookup(word: string): Promise<EcdictEntry | null> {
  try {
    const client = getClient();
    // Try exact match first, then case-insensitive fallback
    // ECDICT stores some proper nouns with original casing (e.g. "Islam", "January")
    let result = await client.execute({
      sql: 'SELECT * FROM ecdict WHERE word = ? COLLATE NOCASE',
      args: [word],
    });

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      word: row.word as string,
      phonetic: (row.phonetic as string) || null,
      definition: unescapeNewlines(row.definition as string),
      translation: unescapeNewlines(row.translation as string),
      pos: (row.pos as string) || null,
      collins: row.collins != null ? Number(row.collins) : null,
      oxford: row.oxford != null ? Number(row.oxford) : null,
      tag: (row.tag as string) || null,
      bnc: row.bnc != null ? Number(row.bnc) : null,
      frq: row.frq != null ? Number(row.frq) : null,
      exchange: (row.exchange as string) || null,
    };
  } catch {
    // DB may not exist yet (import-ecdict not run)
    return null;
  }
}

/**
 * Batch look up multiple words in ECDICT. Returns a Map of word → EcdictEntry.
 * Words not found are omitted from the result.
 *
 * ECDICT stores some words with original casing (e.g. "Islam", "January"),
 * so we query with original casing first, then fallback to lowercase.
 * The map keys use the original ECDICT casing so callers can match results.
 */
export async function ecdictBatchLookup(words: string[]): Promise<Map<string, EcdictEntry>> {
  const result = new Map<string, EcdictEntry>();
  if (words.length === 0) return result;

  try {
    const client = getClient();
    // Deduplicate case-insensitively: keep original form, track lowercase→original mapping
    const uniqueOriginals = [...new Set(words)];
    const lowerToOriginal = new Map<string, string>();
    for (const w of uniqueOriginals) {
      const lower = w.toLowerCase();
      if (!lowerToOriginal.has(lower)) {
        lowerToOriginal.set(lower, w);
      }
    }
    const allKeys = [...lowerToOriginal.keys()]; // lowercase unique keys

    // SQLite has a hard limit on variable bindings (typically 999).
    // Process in chunks to stay safe.
    const CHUNK = 200;
    for (let i = 0; i < allKeys.length; i += CHUNK) {
      const chunk = allKeys.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await client.execute({
        sql: `SELECT * FROM ecdict WHERE word COLLATE NOCASE IN (${placeholders})`,
        args: chunk,
      });

      for (const row of rows.rows) {
        const ecdictWord = row.word as string;
        result.set(ecdictWord, {
          word: ecdictWord,
          phonetic: (row.phonetic as string) || null,
          definition: unescapeNewlines(row.definition as string),
          translation: unescapeNewlines(row.translation as string),
          pos: (row.pos as string) || null,
          collins: row.collins != null ? Number(row.collins) : null,
          oxford: row.oxford != null ? Number(row.oxford) : null,
          tag: (row.tag as string) || null,
          bnc: row.bnc != null ? Number(row.bnc) : null,
          frq: row.frq != null ? Number(row.frq) : null,
          exchange: (row.exchange as string) || null,
        });
        // Also map by lowercase for callers that search by lowercase
        result.set(ecdictWord.toLowerCase(), result.get(ecdictWord)!);
      }
    }
  } catch {
    // DB may not exist yet
  }

  return result;
}

/**
 * Check if the ECDICT database exists and is populated.
 */
export async function ecdictIsAvailable(): Promise<boolean> {
  try {
    const client = getClient();
    const result = await client.execute('SELECT COUNT(*) as cnt FROM ecdict LIMIT 1');
    return Number(result.rows[0].cnt) > 0;
  } catch {
    return false;
  }
}

// ── Source adapter ────────────────────────────────────────────────────────

import type { DictSource, DefGroup } from './types';

/**
 * DictSource adapter for ECDICT. Returns Partial<DictEntry> suitable for
 * merging with other sources via mergeMultiple().
 */
export const ecdictSource: DictSource = {
	name: 'ecdict',
	available: ecdictIsAvailable,
	lookup: async (word: string) => {
		const entry = await ecdictLookup(word);
		if (!entry) return null;

		// Build DefGroup from ECDICT English definitions
		let definitions: DefGroup[] = [];
		if (entry.definition) {
			const lines = entry.definition.split('\n').filter(Boolean);
			if (lines.length > 0) {
				definitions.push({
					partOfSpeech: entry.pos || '',
					definitions: lines.map((d) => ({
						definition: d.replace(/^[a-z]+\.\s*/, ''),
					})),
				});
			}
		}

		return {
			word: entry.word,
			phonetic: entry.phonetic ?? undefined,
			translation: entry.translation ?? '',
			definitions,
			collins: entry.collins ?? null,
			tag: entry.tag ?? null,
			bnc: entry.bnc ?? null,
			frq: entry.frq ?? null,
			exchange: entry.exchange ?? null,
			synonyms: [],
			antonyms: [],
			source: 'ecdict',
		};
	},
};
