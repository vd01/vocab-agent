/**
 * Registry unit tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { registry } from './registry';
import type { DictSource, DictEntry } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeSource(
	name: string,
	available = true,
	data: Partial<DictEntry> | null = null,
): DictSource {
	return {
		name,
		available: async () => available,
		lookup: async (_word) => data,
	};
}

const mockEntry: Partial<DictEntry> = {
	word: 'test',
	phonetic: '/tɛst/',
	translation: '测试',
	definitions: [],
	synonyms: [],
	antonyms: [],
	source: 'mock',
};

beforeEach(() => {
	// Clear registry between tests
	for (const s of registry.getSources()) {
		registry.unregister(s.name);
	}
});

describe('DictRegistry', () => {
	describe('registration', () => {
		it('registers a source', () => {
			const src = makeSource('s1');
			registry.register(src);
			expect(registry.getSources()).toHaveLength(1);
			expect(registry.getSources()[0].name).toBe('s1');
		});

		it('ignores duplicate names', () => {
			registry.register(makeSource('s1'));
			registry.register(makeSource('s1'));
			expect(registry.getSources()).toHaveLength(1);
		});

		it('maintains registration order', () => {
			registry.register(makeSource('a'));
			registry.register(makeSource('b'));
			registry.register(makeSource('c'));
			expect(registry.getSources().map((s) => s.name)).toEqual([
				'a',
				'b',
				'c',
			]);
		});

		it('unregisters by name', () => {
			registry.register(makeSource('a'));
			registry.register(makeSource('b'));
			registry.unregister('a');
			expect(registry.getSources().map((s) => s.name)).toEqual(['b']);
		});

		it('unregister is no-op for unknown name', () => {
			registry.register(makeSource('a'));
			registry.unregister('nonexistent');
			expect(registry.getSources()).toHaveLength(1);
		});
	});

	describe('getAvailableSources', () => {
		it('returns only available sources', async () => {
			registry.register(makeSource('s1', true));
			registry.register(makeSource('s2', false));
			registry.register(makeSource('s3', true));
			const avail = await registry.getAvailableSources();
			expect(avail.map((s) => s.name)).toEqual(['s1', 's3']);
		});

		it('handles source that throws during available()', async () => {
			registry.register({
				name: 'unstable',
				available: async () => {
					throw new Error('boom');
				},
				lookup: async () => null,
			});
			registry.register(makeSource('stable', true));
			const avail = await registry.getAvailableSources();
			expect(avail.map((s) => s.name)).toEqual(['stable']);
		});
	});

	describe('lookupAll', () => {
		it('returns results in registration order', async () => {
			registry.register(makeSource('a', true, mockEntry));
			registry.register(makeSource('b', true, null));
			registry.register(makeSource('c', true, mockEntry));
			const results = await registry.lookupAll('test');
			expect(results).toHaveLength(3);
			expect(results[0]).not.toBeNull();
			expect(results[0]!.source).toBe('mock');
			expect(results[1]).toBeNull(); // b returned null
			expect(results[2]).not.toBeNull();
		});

		it('skips unavailable sources (lookup returns null)', async () => {
			// lookupAll does NOT call available() — it relies on lookup() returning null
			// for unavailable sources. So we make the unavailable source's lookup return null.
			registry.register(makeSource('a', false, null));
			registry.register(makeSource('b', true, mockEntry));
			const results = await registry.lookupAll('test');
			expect(results).toHaveLength(2);
			expect(results[0]).toBeNull(); // a's lookup returned null
			expect(results[1]).not.toBeNull();
		});

		it('handles source that throws during lookup', async () => {
			registry.register({
				name: 'unstable',
				available: async () => true,
				lookup: async () => {
					throw new Error('lookup failed');
				},
			});
			registry.register(makeSource('stable', true, mockEntry));
			const results = await registry.lookupAll('word');
			expect(results[0]).toBeNull(); // threw → null
			expect(results[1]).not.toBeNull();
		});
	});
});
