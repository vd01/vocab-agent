/**
 * Wiktionary REST API client — online on-demand lookup.
 *
 * Uses the Wikimedia REST API v1 for structured JSON responses.
 * No API key required. CC-BY-SA 4.0 — attribution required when displaying results.
 *
 * Rate limit: recommended to stay under ~200 req/min.
 * Endpoint: GET /api/rest_v1/page/definition/{word}
 * Fallback: GET /api/rest_v1/page/summary/{word} (simpler but less detail)
 *
 * The definition endpoint returns data grouped by language:
 *   { en: [{ partOfSpeech, language, definitions }], fr: [...], ... }
 * We extract only the English ("en") section.
 */

const USER_AGENT = 'vocab-agent/1.0 (https://github.com/vocab-agent; CC-BY-SA attribution)';
const API_BASE = 'https://en.wiktionary.org/api/rest_v1';
const TIMEOUT_MS = 3000;
const RETRY_DELAY_MS = 1000;

// ── Response types ───────────────────────────────────────────────────────

interface WiktionaryDefinition {
	definition: string;
	partOfSpeech?: string;
	examples?: string[];
}

/** Per-language section from the definition endpoint. */
interface WiktionaryLangSection {
	partOfSpeech: string;
	language: string;
	definitions: WiktionaryDefinition[];
}

/** Full response from /page/definition — keyed by language code. */
type WiktionaryPageDefinition = Record<string, WiktionaryLangSection[]>;

interface WiktionaryPageSummary {
	title: string;
	extract: string; // Plain text summary
	lang?: string;
}

export interface WiktionaryEntry {
	word: string;
	etymology?: string;
	forms?: Array<{ form: string; tags: string[] }>;
	ipa?: string;
	definitions: Array<{ partOfSpeech: string; definitions: WiktionaryDefinition[] }>;
}

// ── Internal ─────────────────────────────────────────────────────────────

/**
 * Fetch from the Wiktionary REST API with timeout and optional retry.
 */
async function wiktionaryFetch<T>(path: string, retry = true): Promise<T | null> {
	const url = `${API_BASE}${path}`;
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});

		if (res.status === 429 && retry) {
			// Rate limited — wait and retry once
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
			return wiktionaryFetch<T>(path, false);
		}

		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

/**
 * Fetch structured definitions from REST v1 page/definition endpoint.
 * Returns structured definitions grouped by part of speech.
 */
async function fetchDefinition(
	word: string,
): Promise<WiktionaryPageDefinition | null> {
	return wiktionaryFetch<WiktionaryPageDefinition>(
		`/page/definition/${encodeURIComponent(word)}`,
	);
}

/**
 * Fetch page summary (simpler API with extract field).
 * Used as fallback when definition endpoint returns nothing useful.
 */
async function fetchSummary(
	word: string,
): Promise<WiktionaryPageSummary | null> {
	return wiktionaryFetch<WiktionaryPageSummary>(
		`/page/summary/${encodeURIComponent(word)}`,
	);
}

/**
 * Try to extract etymology and IPA from the structured data.
 * The REST v1 definition endpoint includes limited metadata;
 * full etymology/forms typically require wikitext parsing (Phase C offline dump).
 */
function extractMetadata(
	def: WiktionaryPageDefinition | null,
): { etymology?: string; ipa?: string } {
	if (!def) return {};

	// Wiktionary REST v1 definition API does not currently expose etymology
	// or IPA in a structured field. These come from Phase C (Kaikki dump).
	// For now, the summary.extract may contain a brief etymology mention.
	return {};
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Look up a word from Wiktionary REST API.
 * Fetches definition and summary endpoints in parallel for speed.
 * Returns structured data: definitions by POS, and (in Phase C) etymology/forms/IPA.
 */
export async function wiktionaryRestLookup(
	word: string,
): Promise<WiktionaryEntry | null> {
	// Fetch both endpoints in parallel to avoid serial latency
	const [def, summary] = await Promise.all([
		fetchDefinition(word),
		fetchSummary(word),
	]);

	// Prefer structured definition if available
	// The API returns { en: [...], fr: [...], ... } — extract English section
	const enSections = def?.en;
	if (enSections && enSections.length > 0) {
		const metadata = extractMetadata(def);
		return {
			word,
			...metadata,
			definitions: enSections.map((g) => ({
				partOfSpeech: g.partOfSpeech,
				definitions: g.definitions || [],
			})),
		};
	}

	// Fallback: summary endpoint (less structured)
	if (summary && summary.extract) {
		return {
			word: summary.title || word,
			definitions: [
				{
					partOfSpeech: '',
					definitions: [{ definition: summary.extract }],
				},
			],
		};
	}

	return null;
}
