/**
 * Unified dictionary lookup — merges ECDICT (offline) + Free Dictionary API (online).
 *
 * Strategy:
 * - ECDICT provides: Chinese definitions, phonetics, frequency, exam tags, word forms
 * - API provides: English definitions with examples, synonyms/antonyms, audio URLs, etymology
 * - Either source alone is sufficient to return a result
 * - When both are available, data is merged
 */

import { ecdictLookup, type EcdictEntry } from './ecdict';
import { freeDictLookup, type FreeDictEntry, type FreeDictMeaning } from './free-dict-api';

// ── Types ────────────────────────────────────────────────────────────────

export interface DefGroup {
  partOfSpeech: string;
  definitions: { definition: string; example?: string }[];
}

export interface DictEntry {
  word: string;
  phonetic: string;
  translation: string;        // Chinese definitions (from ECDICT)
  definitions: DefGroup[];    // English definitions with examples (from API)
  collins: number | null;     // Collins star rating 1-5
  tag: string | null;         // Exam tags: "cet4 cet6 gre"
  bnc: number | null;         // BNC frequency rank
  frq: number | null;         // Contemporary corpus frequency rank
  exchange: string | null;    // Inflected forms
  audioUrl: string | null;    // Pronunciation audio MP3 URL
  synonyms: string[];         // From API
  antonyms: string[];         // From API
  origin: string | null;      // Etymology (from API)
  source: 'ecdict' | 'api' | 'both';
}

// ── LRU Cache ────────────────────────────────────────────────────────────

const CACHE_MAX = 500;
const cache = new Map<string, DictEntry>();

function cacheGet(word: string): DictEntry | undefined {
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
  // Evict oldest entries if over limit
  if (cache.size > CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

// ── Merge logic ──────────────────────────────────────────────────────────

/**
 * Pick the preferred pronunciation audio URL from a list of MP3 URLs.
 * Preference order: US variant -> UK variant -> any other.
 * Free Dictionary API URLs look like:
 *   .../en/<word>-us.mp3, .../en/<word>-uk.mp3, .../en/<word>-au.mp3
 */
function pickPreferredAudio(audios: string[]): string | null {
  if (audios.length === 0) return null;
  return audios.find(a => a.includes('-us'))
    ?? audios.find(a => a.includes('-uk'))
    ?? audios[0];
}

function mergeEntries(word: string, ecdict: EcdictEntry | null, api: FreeDictEntry | null): DictEntry | null {
  // Both null = not found
  if (!ecdict && !api) return null;

  const source = ecdict && api ? 'both' : ecdict ? 'ecdict' : 'api';

  // Phonetic: prefer API (more accurate IPA), fallback to ECDICT
  let phonetic = '';
  if (api?.phonetic) {
    phonetic = api.phonetic;
  } else if (api?.phonetics?.length) {
    phonetic = api.phonetics.find(p => p.text)?.text ?? '';
  }
  if (!phonetic && ecdict?.phonetic) {
    phonetic = ecdict.phonetic;
  }

  // Audio URL from API - prefer US pronunciation, then UK, then any available
  const audioUrl = api?.phonetics?.find(p => p.audio)?.audio
    ? pickPreferredAudio(api.phonetics.map(p => p.audio).filter((a): a is string => !!a))
    : null;

  // English definitions from API (with examples)
  const definitions: DefGroup[] = [];
  if (api?.meanings) {
    for (const m of api.meanings) {
      definitions.push({
        partOfSpeech: m.partOfSpeech,
        definitions: m.definitions
          .filter(d => d.definition)
          .map(d => ({
            definition: d.definition,
            example: d.example,
          })),
      });
    }
  }

  // If no API definitions but ECDICT has English defs, convert them
  if (definitions.length === 0 && ecdict?.definition) {
    const lines = ecdict.definition.split('\n').filter(Boolean);
    if (lines.length > 0) {
      definitions.push({
        partOfSpeech: ecdict.pos || '',
        definitions: lines.map(d => ({ definition: d.replace(/^[a-z]+\.\s*/, '') })),
      });
    }
  }

  // Synonyms / antonyms from API
  const synonyms: string[] = [];
  const antonyms: string[] = [];
  if (api?.meanings) {
    for (const m of api.meanings) {
      synonyms.push(...m.synonyms);
      antonyms.push(...m.antonyms);
      for (const d of m.definitions) {
        synonyms.push(...d.synonyms);
        antonyms.push(...d.antonyms);
      }
    }
  }
  // Deduplicate
  const uniqueSynonyms = [...new Set(synonyms)].slice(0, 20);
  const uniqueAntonyms = [...new Set(antonyms)].slice(0, 20);

  return {
    word,
    phonetic,
    translation: ecdict?.translation ?? '',
    definitions,
    collins: ecdict?.collins ?? null,
    tag: ecdict?.tag ?? null,
    bnc: ecdict?.bnc ?? null,
    frq: ecdict?.frq ?? null,
    exchange: ecdict?.exchange ?? null,
    audioUrl,
    synonyms: uniqueSynonyms,
    antonyms: uniqueAntonyms,
    origin: api?.origin ?? null,
    source,
  };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Look up a word from all available dictionary sources.
 * Results are cached in memory (LRU, max 500 entries).
 */
export async function lookupWord(word: string): Promise<DictEntry | null> {
  const normalized = word.toLowerCase().trim();

  // Check cache first
  const cached = cacheGet(normalized);
  if (cached) return cached;

  // Query both sources in parallel
  const [ecdictResult, apiResult] = await Promise.all([
    ecdictLookup(normalized),
    freeDictLookup(normalized),
  ]);

  const entry = mergeEntries(normalized, ecdictResult, apiResult);
  if (entry) cacheSet(normalized, entry);

  return entry;
}

/**
 * Look up a word from ECDICT only (offline, no network).
 */
export async function lookupWordOffline(word: string): Promise<DictEntry | null> {
  const normalized = word.toLowerCase().trim();

  const cached = cacheGet(normalized);
  if (cached && (cached.source === 'ecdict' || cached.source === 'both')) return cached;

  const ecdictResult = await ecdictLookup(normalized);
  const entry = mergeEntries(normalized, ecdictResult, null);
  if (entry) cacheSet(normalized, entry);

  return entry;
}
