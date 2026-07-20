/**
 * Free Dictionary API (dictionaryapi.dev) — online English dictionary.
 *
 * Provides detailed English definitions, example sentences,
 * synonyms/antonyms, phonetics with audio URLs, and etymology.
 * Free, no API key required, no documented rate limits.
 */

import type { DefGroup } from './types';

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
      signal: AbortSignal.timeout(3000), // 3s timeout for quick response
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

// ── Source adapter ────────────────────────────────────────────────────────

import type { DictSource } from './types';

/** Pick the preferred pronunciation audio URL (US > UK > other). */
function pickPreferredAudio(audios: string[]): string | null {
	if (audios.length === 0) return null;
	return (
		audios.find((a) => a.includes('-us')) ??
		audios.find((a) => a.includes('-uk')) ??
		audios[0]
	);
}

/**
 * DictSource adapter for the Free Dictionary API.
 */
export const freeDictSource: DictSource = {
	name: 'freedict',
	available: async () => true, // always available (network-dependent)
	lookup: async (word: string) => {
		const entry = await freeDictLookup(word);
		if (!entry) return null;

		const phonetic =
			entry.phonetic ??
			entry.phonetics.find((p) => p.text)?.text ??
			'';

		const audioCandidates = entry.phonetics
			.map((p) => p.audio)
			.filter((a): a is string => !!a);
		const audioUrl = pickPreferredAudio(audioCandidates);

		const definitions: DefGroup[] = (entry.meanings ?? []).map((m) => ({
			partOfSpeech: m.partOfSpeech,
			definitions: m.definitions
				.filter((d) => d.definition)
				.map((d) => ({
					definition: d.definition,
					example: d.example,
				})),
		}));

		// Collect + deduplicate synonyms / antonyms
		const synSet = new Set<string>();
		const antSet = new Set<string>();
		for (const m of entry.meanings ?? []) {
			for (const s of m.synonyms) synSet.add(s);
			for (const a of m.antonyms) antSet.add(a);
			for (const d of m.definitions) {
				for (const s of d.synonyms) synSet.add(s);
				for (const a of d.antonyms) antSet.add(a);
			}
		}

		return {
			word: entry.word,
			phonetic,
			translation: '', // API provides no Chinese
			definitions,
			audioUrl,
			synonyms: [...synSet].slice(0, 20),
			antonyms: [...antSet].slice(0, 20),
			origin: entry.origin ?? null,
			source: 'freedict',
		};
	},
};
