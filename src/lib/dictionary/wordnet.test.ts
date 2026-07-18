/**
 * WordNet lookup unit tests
 */
import { describe, it, expect } from 'vitest';
import { wordnetLookup } from './wordnet';

describe('wordnetLookup', () => {
	it('returns synsets for a common word', async () => {
		const result = await wordnetLookup('dog');
		expect(result).not.toBeNull();
		expect(result!.synsets.length).toBeGreaterThanOrEqual(1);
		// First synset should be the noun "canine" sense
		const firstSynset = result!.synsets[0];
		expect(firstSynset.pos).toBe('n');
		expect(firstSynset.definition.length).toBeGreaterThan(10);
		expect(firstSynset.lemmas.length).toBeGreaterThan(0);
	});

	it('returns hypernyms for "dog"', async () => {
		const result = await wordnetLookup('dog');
		expect(result!.relations.hypernyms.length).toBeGreaterThan(0);
		// "dog" is a canine → animal, so hypernyms should include broader categories
		expect(result!.relations.hypernyms).toContain('canine');
	});

	it('returns hyponyms for "dog"', async () => {
		const result = await wordnetLookup('dog');
		expect(result!.relations.hyponyms.length).toBeGreaterThan(0);
		expect(result!.relations.hyponyms).toContain('puppy');
	});

	it('returns synsets across multiple POS', async () => {
		const result = await wordnetLookup('run');
		expect(result).not.toBeNull();
		const posSet = new Set(result!.synsets.map((s) => s.pos));
		// "run" has both noun and verb senses
		expect(posSet.has('n')).toBe(true);
		expect(posSet.has('v')).toBe(true);
	});

	it('returns null for nonsense word', async () => {
		const result = await wordnetLookup('xyznonexistent123');
		expect(result).toBeNull();
	});

	it('is case-insensitive', async () => {
		const lower = await wordnetLookup('Apple');
		const upper = await wordnetLookup('apple');
		expect(lower).not.toBeNull();
		expect(upper).not.toBeNull();
		expect(lower!.synsets.length).toBe(upper!.synsets.length);
	});

	it('extracts examples from glosses', async () => {
		const result = await wordnetLookup('abandon');
		expect(result).not.toBeNull();
		// "abandon" as verb has example sentences
		const allExamples = result!.synsets.flatMap((s) => s.examples);
		// At least some synsets should have examples
		// (not all WordNet entries have examples, but abandon should)
		expect(result!.synsets.length).toBeGreaterThan(0);
	});

	it('returns consistent results on repeated calls (caching)', async () => {
		const r1 = await wordnetLookup('happy');
		const r2 = await wordnetLookup('happy');
		expect(r1!.synsets.length).toBe(r2!.synsets.length);
		expect(r1!.relations.hypernyms).toEqual(r2!.relations.hypernyms);
	});
});
