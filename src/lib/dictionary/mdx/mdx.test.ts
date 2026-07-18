/**
 * MDX lookup smoke test — uses the actual MDX files in data/mdx/.
 *
 * These tests require MDX files to be present. If files are missing,
 * some tests are skipped gracefully.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { scanMdxSources } from './index';
import type { DictSource } from '../types';

describe('MDX lookup', () => {
	let sources: DictSource[];
	let sourceNames: string[];

	beforeAll(async () => {
		sources = await scanMdxSources();
		sourceNames = sources.map((s) => s.name);
	}, 15000); // 15s timeout for first load (parses MDX files)

	it('detects installed MDX dictionaries', () => {
		expect(sourceNames.length).toBeGreaterThanOrEqual(1);
		console.log('Found MDX sources:', sourceNames);
	});

	it('scanMdxSources is idempotent (cached)', async () => {
		const sources2 = await scanMdxSources();
		expect(sources2).toBe(sources); // same reference — cached
	});

	// Test all sources by iterating in a single test (avoids static for-loop race)
	it('all sources can look up "test"', async () => {
		for (const source of sources) {
			const result = await source.lookup('test');
			expect(result).not.toBeNull();
			expect(result!.word).toBeDefined();
			expect(result!.mdxEntries).toBeDefined();
			expect(result!.mdxEntries!.length).toBeGreaterThanOrEqual(1);

			const entry = result!.mdxEntries![0];
			expect(entry.dict).toBeTruthy();
			expect(entry.html.length).toBeGreaterThan(0);
		}
	}, 30000);

	it('all sources can look up "happy"', async () => {
		for (const source of sources) {
			const result = await source.lookup('happy');
			expect(result).not.toBeNull();
			expect(result!.mdxEntries).toBeDefined();
			expect(result!.mdxEntries![0].html.toLowerCase()).toContain('happy');
		}
	}, 30000);

	it('returns null/empty for nonexistent words in all sources', async () => {
		for (const source of sources) {
			const result = await source.lookup('xyznonexistentword99999');
			if (result === null) {
				expect(result).toBeNull();
			} else {
				const text = result.mdxEntries?.[0]?.text ?? '';
				expect(text.length).toBeLessThan(50);
			}
		}
	}, 30000);
});
