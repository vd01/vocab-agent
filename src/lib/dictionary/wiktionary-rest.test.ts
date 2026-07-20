/**
 * Wiktionary REST client unit tests (mocked fetch, no network).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the internal parsing by mocking the fetch call.
// The actual API returns data grouped by language: { en: [...], fr: [...], ... }
describe('wiktionaryRestLookup', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('parses structured definition response', async () => {
		// Simulate the actual API response format: language-grouped
		const mockResponse = {
			en: [
				{
					partOfSpeech: 'noun',
					language: 'English',
					definitions: [
						{ definition: 'A procedure for critical evaluation', examples: ['take a test'] },
						{ definition: 'A hard outer covering', examples: [] },
					],
				},
				{
					partOfSpeech: 'verb',
					language: 'English',
					definitions: [{ definition: 'To examine critically', examples: [] }],
				},
			],
		};

		// First fetch (definition endpoint) returns the grouped response
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		});
		// Second fetch (summary endpoint) — not needed when definition succeeds
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: async () => ({ title: 'test', extract: 'A test is...' }),
		});

		const { wiktionaryRestLookup } = await import('./wiktionary-rest');
		const result = await wiktionaryRestLookup('test');

		expect(result).not.toBeNull();
		expect(result!.word).toBe('test');
		expect(result!.definitions).toHaveLength(2);
		expect(result!.definitions[0].partOfSpeech).toBe('noun');
		expect(result!.definitions[0].definitions).toHaveLength(2);
		expect(result!.definitions[0].definitions[0].definition).toContain('critical evaluation');
	});

	it('returns null on 404', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 404,
		});

		const { wiktionaryRestLookup } = await import('./wiktionary-rest');
		const result = await wiktionaryRestLookup('nonexistentword12345');
		expect(result).toBeNull();
	});

	it('falls back to summary endpoint when definition is empty', async () => {
		// First call (definition) returns 200 but no English section
		(globalThis.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ fr: [{ partOfSpeech: 'noun', definitions: [] }] }),
			})
			// Second call (summary) returns extract
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					title: 'hello',
					extract: 'Hello is a salutation or greeting in the English language.',
				}),
			});

		const { wiktionaryRestLookup } = await import('./wiktionary-rest');
		const result = await wiktionaryRestLookup('hello');

		expect(result).not.toBeNull();
		expect(result!.definitions).toHaveLength(1);
		expect(result!.definitions[0].definitions[0].definition).toContain('salutation');
	});

	it('retries on 429 rate limit', async () => {
		// Both definition and summary are fetched in parallel.
		// Definition gets 429, retries, then succeeds.
		// Summary also needs a response (can be null/404).
		(globalThis.fetch as ReturnType<typeof vi.fn>)
			// 1st call: definition endpoint → 429
			.mockResolvedValueOnce({ ok: false, status: 429 })
			// 2nd call: summary endpoint (parallel) → 404
			.mockResolvedValueOnce({ ok: false, status: 404 })
			// 3rd call: definition retry → success
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					en: [{ partOfSpeech: 'noun', language: 'English', definitions: [{ definition: 'A trial' }] }],
				}),
			});

		const { wiktionaryRestLookup } = await import('./wiktionary-rest');
		const result = await wiktionaryRestLookup('test');

		expect(result).not.toBeNull();
	});

	it('handles network errors gracefully', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

		const { wiktionaryRestLookup } = await import('./wiktionary-rest');
		const result = await wiktionaryRestLookup('test');
		expect(result).toBeNull();
	});
});
