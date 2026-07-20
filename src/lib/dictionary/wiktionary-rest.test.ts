/**
 * Wiktionary REST client unit tests (mocked fetch, no network).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the internal parsing by mocking the fetch call.
// The module under test calls the real Wiktionary API; we intercept fetch.
describe('wiktionaryRestLookup', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('parses structured definition response', async () => {
		const mockResponse = {
			word: 'test',
			language: 'English',
			definitions: [
				{
					partOfSpeech: 'noun',
					definitions: [
						{ definition: 'A procedure for critical evaluation', examples: ['take a test'] },
						{ definition: 'A hard outer covering', examples: [] },
					],
				},
				{
					partOfSpeech: 'verb',
					definitions: [{ definition: 'To examine critically', examples: [] }],
				},
			],
		};

		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
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
		// First call (definition) returns 200 but empty definitions
		(globalThis.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ word: 'hello', definitions: [] }),
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
		(globalThis.fetch as ReturnType<typeof vi.fn>)
			// First call: rate limited
			.mockResolvedValueOnce({ ok: false, status: 429 })
			// Retry: succeeds
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					word: 'test',
					definitions: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A trial' }] }],
				}),
			});

		const { wiktionaryRestLookup } = await import('./wiktionary-rest');
		const result = await wiktionaryRestLookup('test');

		expect(result).not.toBeNull();
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	it('handles network errors gracefully', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

		const { wiktionaryRestLookup } = await import('./wiktionary-rest');
		const result = await wiktionaryRestLookup('test');
		expect(result).toBeNull();
	});
});
