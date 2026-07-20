/**
 * Merge multiple Partial<DictEntry> results into a unified DictEntry.
 *
 * Strategy:
 * - Each source populates its DEDICATED fields (mdxEntries, synsets, etc.)
 *   so per-source data is preserved, not collapsed into one field.
 * - Shared text fields (translation, phonetic): first non-empty wins,
 *   keeping ECDICT's concise Chinese gloss as the primary translation.
 * - definitions: COMBINE from all sources (deduplicated by definition text)
 * - synonyms/antonyms: COMBINE from all sources (deduplicated)
 * - metadata (collins, tag, bnc, etc.): first non-empty wins
 * - per-source fields (mdxEntries, synsets, etymology, etc.): COMBINE
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

	const sourceNames: string[] = [first.source ?? 'unknown'];

	// Accumulators for combined fields
	const allDefGroups: DefGroup[] = [...(first.definitions ?? [])];
	const synSet = new Set(first.synonyms ?? []);
	const antSet = new Set(first.antonyms ?? []);
	const allMdxEntries: NonNullable<DictEntry['mdxEntries']> = [...(first.mdxEntries ?? [])];
	const allSynsets: NonNullable<DictEntry['synsets']> = [...(first.synsets ?? [])];
	const allIpa: NonNullable<DictEntry['ipa']> = [...(first.ipa ?? [])];
	const allForms: NonNullable<DictEntry['forms']> = [...(first.forms ?? [])];

	for (let i = 1; i < valid.length; i++) {
		const r = valid[i];
		if (r.source) sourceNames.push(r.source);

		// Shared text fields: first non-empty wins
		if (!merged.word && r.word) merged.word = r.word;
		if (!merged.phonetic && r.phonetic) merged.phonetic = r.phonetic;
		if (!merged.translation && r.translation) merged.translation = r.translation;
		if (!merged.origin && r.origin) merged.origin = r.origin;
		if (!merged.etymology && r.etymology) merged.etymology = r.etymology;

		// Definitions: combine from all sources (deduplicated)
		if (r.definitions && r.definitions.length > 0) {
			for (const group of r.definitions) {
				let existing = allDefGroups.find(
					(g) => g.partOfSpeech === group.partOfSpeech,
				);
				if (!existing) {
					existing = { partOfSpeech: group.partOfSpeech, definitions: [] };
					allDefGroups.push(existing);
				}
				for (const def of group.definitions) {
					if (!existing.definitions.some(
						(d) => d.definition === def.definition,
					)) {
						existing.definitions.push(def);
					}
				}
			}
		}

		// Synonyms/antonyms: combine and deduplicate
		if (r.synonyms) for (const s of r.synonyms) synSet.add(s);
		if (r.antonyms) for (const a of r.antonyms) antSet.add(a);

		// Per-source fields: combine
		if (r.mdxEntries) allMdxEntries.push(...r.mdxEntries);
		if (r.synsets) allSynsets.push(...r.synsets);
		if (r.ipa) allIpa.push(...r.ipa);
		if (r.forms) allForms.push(...r.forms);

		// Semantic relations: first non-empty wins (WordNet only)
		if (!merged.semanticRelations && r.semanticRelations) {
			merged.semanticRelations = r.semanticRelations;
		}

		// Metadata: first non-empty wins (ECDICT only)
		if (merged.collins == null && r.collins != null) merged.collins = r.collins;
		if (merged.tag == null && r.tag != null) merged.tag = r.tag;
		if (merged.bnc == null && r.bnc != null) merged.bnc = r.bnc;
		if (merged.frq == null && r.frq != null) merged.frq = r.frq;
		if (merged.exchange == null && r.exchange != null) merged.exchange = r.exchange;
		if (merged.audioUrl == null && r.audioUrl != null) merged.audioUrl = r.audioUrl;
	}

	merged.definitions = allDefGroups;
	merged.synonyms = [...synSet].slice(0, 30);
	merged.antonyms = [...antSet].slice(0, 30);
	if (allMdxEntries.length > 0) merged.mdxEntries = allMdxEntries;
	if (allSynsets.length > 0) merged.synsets = allSynsets;
	if (allIpa.length > 0) merged.ipa = allIpa;
	if (allForms.length > 0) merged.forms = allForms;

	merged.source = [...new Set(sourceNames)].join('+');

	return merged;
}
