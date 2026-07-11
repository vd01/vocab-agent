/**
 * Free Dictionary API (dictionaryapi.dev) — online English dictionary.
 *
 * Provides detailed English definitions, example sentences,
 * synonyms/antonyms, phonetics with audio URLs, and etymology.
 * Free, no API key required, no documented rate limits.
 */

export interface FreeDictPhonetic {
  text?: string;
  audio?: string;  // MP3 URL for pronunciation
}

export interface FreeDictDefinition {
  definition: string;
  example?: string;
  synonyms: string[];
  antonyms: string[];
}

export interface FreeDictMeaning {
  partOfSpeech: string;  // noun, verb, adjective, etc.
  definitions: FreeDictDefinition[];
  synonyms: string[];
  antonyms: string[];
}

export interface FreeDictEntry {
  word: string;
  phonetic?: string;
  phonetics: FreeDictPhonetic[];
  meanings: FreeDictMeaning[];
  origin?: string;  // Etymology
}

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

/**
 * Look up a word from the Free Dictionary API.
 * Returns null if the word is not found or the API is unreachable.
 */
export async function freeDictLookup(word: string): Promise<FreeDictEntry | null> {
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(word.toLowerCase())}`, {
      signal: AbortSignal.timeout(8000), // 8s timeout
    });

    if (!res.ok) return null; // 404 = not found

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    // API returns an array; use the first entry
    const entry = data[0];
    return {
      word: entry.word ?? word,
      phonetic: entry.phonetic,
      phonetics: (entry.phonetics ?? [])
        .filter((p: any) => p.text || p.audio)
        .map((p: any) => ({
          text: p.text,
          audio: p.audio,
        })),
      meanings: (entry.meanings ?? []).map((m: any) => ({
        partOfSpeech: m.partOfSpeech ?? '',
        definitions: (m.definitions ?? []).map((d: any) => ({
          definition: d.definition ?? '',
          example: d.example,
          synonyms: d.synonyms ?? [],
          antonyms: d.antonyms ?? [],
        })),
        synonyms: m.synonyms ?? [],
        antonyms: m.antonyms ?? [],
      })),
      origin: entry.origin,
    };
  } catch {
    // Network error, timeout, etc.
    return null;
  }
}
