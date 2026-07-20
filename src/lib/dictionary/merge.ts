/**
 * Merge multiple Partial<DictEntry> results into a unified DictEntry.
 *
 * Strategy: iterate sources in registration order (highest priority first).
 * For each field, the first source that provides a non-null / non-empty value
 * wins. Later sources fill only fields left undefined by earlier ones.
 */

import type { DictEntry, DefGroup } from './types';

/**
 * Merge results from multiple sources (already ordered by priority).
 * Returns null if every source returned null.
 */
export function mergeMultiple(results: (Partial<DictEntry> | null)[]): DictEntry | null {
	const valid = results.filter(
		(r): r is Partial<DictEntry> => r != null,
	);
	if (valid.length === 0) return null;

	const first = valid[0];
	const merged: DictEntry = {
		word: first.word ?? '',
		phonetic: first.phonetic ?? '',
		translation: first.translation ?? '',
		definitions: first.definitions ?? [],
		collins: first.collins ?? null,
		tag: first.tag ?? null,
		bnc: first.bnc ?? null,
		frq: first.frq ?? null,
		exchange: first.exchange ?? null,
		audioUrl: first.audioUrl ?? null,
		synonyms: first.synonyms ?? [],
		antonyms: first.antonyms ?? [],
		origin: first.origin ?? null,
		source: first.source ?? 'unknown',
	};

	// Collect source names for the combined .source field
	const sourceNames: string[] = [first.source ?? 'unknown'];

	for (let i = 1; i < valid.length; i++) {
		const r = valid[i];
		if (r.source) sourceNames.push(r.source);

		// Only fill fields that are still empty in merged
		if (!merged.word && r.word) merged.word = r.word;
		if (!merged.phonetic && r.phonetic) merged.phonetic = r.phonetic;
		if (!merged.translation && r.translation) merged.translation = r.translation;
		if (merged.definitions.length === 0 && r.definitions && r.definitions.length > 0) {
			merged.definitions = r.definitions;
		}
		if (merged.collins == null && r.collins != null) merged.collins = r.collins;
		if (merged.tag == null && r.tag != null) merged.tag = r.tag;
		if (merged.bnc == null && r.bnc != null) merged.bnc = r.bnc;
		if (merged.frq == null && r.frq != null) merged.frq = r.frq;
		if (merged.exchange == null && r.exchange != null) merged.exchange = r.exchange;
		if (merged.audioUrl == null && r.audioUrl != null) merged.audioUrl = r.audioUrl;
		if (merged.synonyms.length === 0 && r.synonyms && r.synonyms.length > 0) {
			merged.synonyms = r.synonyms;
		}
		if (merged.antonyms.length === 0 && r.antonyms && r.antonyms.length > 0) {
			merged.antonyms = r.antonyms;
		}
		if (merged.origin == null && r.origin != null) merged.origin = r.origin;
		if (merged.etymology == null && r.etymology != null) merged.etymology = r.etymology;
		if (merged.forms == null && r.forms != null) merged.forms = r.forms;
		if (merged.ipa == null && r.ipa != null) merged.ipa = r.ipa;
		if (merged.synsets == null && r.synsets != null) merged.synsets = r.synsets;
		if (merged.semanticRelations == null && r.semanticRelations != null) merged.semanticRelations = r.semanticRelations;
		if (merged.mdxEntries == null && r.mdxEntries != null) merged.mdxEntries = r.mdxEntries;
	}

	// Deduplicate source names
	merged.source = [...new Set(sourceNames)].join('+');

	return merged;
}
