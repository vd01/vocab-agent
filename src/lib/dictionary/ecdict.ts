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
    const result = await client.execute({
      sql: 'SELECT * FROM ecdict WHERE word = ?',
      args: [word.toLowerCase()],
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
 */
export async function ecdictBatchLookup(words: string[]): Promise<Map<string, EcdictEntry>> {
  const result = new Map<string, EcdictEntry>();
  if (words.length === 0) return result;

  try {
    const client = getClient();
    const normalized = [...new Set(words.map(w => w.toLowerCase()))];

    // SQLite has a hard limit on variable bindings (typically 999).
    // Process in chunks to stay safe.
    const CHUNK = 200;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const chunk = normalized.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await client.execute({
        sql: `SELECT * FROM ecdict WHERE word IN (${placeholders})`,
        args: chunk,
      });

      for (const row of rows.rows) {
        result.set(row.word as string, {
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
        });
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
