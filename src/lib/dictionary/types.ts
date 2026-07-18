/**
 * Shared types for the multi-source dictionary system.
 *
 * DictEntry is the unified output format consumed by all callers.
 * Sources produce Partial<DictEntry>; merge.ts assembles the final result.
 */

// ── Unified entry ────────────────────────────────────────────────────────

export interface DefGroup {
	partOfSpeech: string;
	definitions: { definition: string; example?: string }[];
}

export interface DictEntry {
	word: string;
	phonetic: string;
	translation: string; // Chinese definitions (from ECDICT)
	definitions: DefGroup[]; // English definitions with examples (from API)
	collins: number | null; // Collins star rating 1-5
	tag: string | null; // Exam tags: "cet4 cet6 gre"
	bnc: number | null; // BNC frequency rank
	frq: number | null; // Contemporary corpus frequency rank
	exchange: string | null; // Inflected forms
	audioUrl: string | null; // Pronunciation audio MP3 URL
	synonyms: string[]; // From API
	antonyms: string[]; // From API
	origin: string | null; // Etymology (from API)
	// Wiktionary fields (Phase B)
	etymology?: string | null; // Detailed etymology from Wiktionary
	forms?: { form: string; tags: string[] }[]; // Inflected forms table
	ipa?: { ipa: string; audio?: string; tag?: string }[]; // Multi-region IPA
	source: string; // Which source(s) provided data
	// MDX fields (Phase D)
	mdxEntries?: { dict: string; html: string; text: string }[];
	// WordNet fields (Phase A)
	synsets?: { pos: string; definition: string; lemmas: string[]; examples: string[] }[];
	semanticRelations?: { hypernyms: string[]; hyponyms: string[] };
}

/**
 * A pluggable dictionary source. Each source produces a Partial<DictEntry>
 * with the fields it can supply. Missing fields are left undefined — merge
 * fills them from higher-priority sources registered earlier.
 */
export interface DictSource {
	readonly name: string;
	/** Returns true if this source is operational right now. */
	available(): Promise<boolean>;
	/** Look up a word. Return null if the word is not in this source. */
	lookup(word: string): Promise<Partial<DictEntry> | null>;
}
