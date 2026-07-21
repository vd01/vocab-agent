/**
 * Wiktionary REST API client — online on-demand lookup.
 *
 * Uses the Wikimedia REST API v1 for structured JSON responses.
 * No API key required. CC-BY-SA 4.0 — attribution required when displaying results.
 *
 * Rate limit: recommended to stay under ~200 req/min.
 * Endpoint: GET /api/rest_v1/page/definition/{word}
 * Fallback: GET /w/rest.php/v1/page/{word} (wikitext source with etymology/IPA)
 *
 * Proxy: Configures undici's global dispatcher from HTTPS_PROXY/https_proxy
 * on first use, so all Node.js native fetch calls respect the proxy.
 */

// ── Proxy Setup (once, global) ───────────────────────────────────────────

let proxyConfigured = false;

function ensureProxyConfigured(): void {
	if (proxyConfigured) return;
	proxyConfigured = true;

	const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
	if (!proxyUrl) return;

	try {
		// Dynamic import is sync-safe inside a try/catch at module level;
		// but we use require for synchronous initialization.
		const { ProxyAgent, setGlobalDispatcher } = require('undici');
		const dispatcher = new ProxyAgent({ uri: proxyUrl });
		setGlobalDispatcher(dispatcher);
		console.log(`[Proxy] Global dispatcher configured: ${proxyUrl}`);
	} catch (e) {
		// undici may not be available in all runtimes; warn and proceed
		console.warn('[Proxy] Failed to configure proxy:', (e as Error).message);
	}
}

// Configure proxy eagerly on module load
ensureProxyConfigured();

// ── Constants ────────────────────────────────────────────────────────────

const USER_AGENT = 'vocab-agent/1.0 (https://github.com/vocab-agent; CC-BY-SA attribution)';
const API_BASE = 'https://en.wiktionary.org/api/rest_v1';
const WIKITEXT_API_BASE = 'https://en.wiktionary.org/w/rest.php/v1';
const TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1000;

// ── Response types ───────────────────────────────────────────────────────

interface WiktionaryDefinition {
	definition: string;
	partOfSpeech?: string;
	examples?: string[];
}

interface WiktionaryLangSection {
	partOfSpeech: string;
	language: string;
	definitions: WiktionaryDefinition[];
}

type WiktionaryPageDefinition = Record<string, WiktionaryLangSection[]>;

interface WiktionaryWikitextPage {
	id: number;
	key: string;
	title: string;
	source?: string;
}

export interface WiktionaryEntry {
	word: string;
	etymology?: string;
	forms?: Array<{ form: string; tags: string[] }>;
	ipa?: string;
	definitions: Array<{ partOfSpeech: string; definitions: WiktionaryDefinition[] }>;
}

// ── Internal ─────────────────────────────────────────────────────────────

async function wiktionaryFetch<T>(baseUrl: string, urlPath: string, retry = true): Promise<T | null> {
	const url = `${baseUrl}${urlPath}`;
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});

		if (res.status === 429 && retry) {
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
			return wiktionaryFetch<T>(baseUrl, urlPath, false);
		}

		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

async function fetchDefinition(
	word: string,
): Promise<WiktionaryPageDefinition | null> {
	return wiktionaryFetch<WiktionaryPageDefinition>(
		API_BASE,
		`/page/definition/${encodeURIComponent(word)}`,
	);
}

async function fetchWikitextSource(
	word: string,
): Promise<WiktionaryWikitextPage | null> {
	return wiktionaryFetch<WiktionaryWikitextPage>(
		WIKITEXT_API_BASE,
		`/page/${encodeURIComponent(word)}`,
	);
}

/**
 * Strip wikitext markup to produce readable plain text.
 */
function stripWikitext(wt: string): string {
	return wt
		// Pre-process: remove nested ref templates like <ref:{{R:...}}> that break matching
		.replace(/<ref:\{\{[^}]*\}\}>/g, '')
		// {{etymon|...|etydate=...}}: extract etydate if present
		.replace(/\{\{etymon\|[^}]*etydate=([^|}]+)[^}]*\}\}/g, '($1)')
		// Named templates with display text (2+ pipe args): extract last meaningful arg
		.replace(/\{\{(m|bor|bor\+|inh|inh\+|der|der\+|cog|cog\+|l|link|w|wp|R:[^|]*|PIE[^|]*|cite[^|]*)\|[^}]*\|([^|}]+)(?:\|[^}]*)?\}\}/g, '$2')
		.replace(/\{\{gl\|([^|}]+)\|([^|}]*)\}\}/g, '$1($2)')
		.replace(/\{\{root\|[^}]*\}\}/g, '')                       // {{root|...}})
		.replace(/\{\{[a-zA-Z+:]*\.\.\.[^}]*\}\}/g, '')                // {{...|t=}} broken templates
		.replace(/\{\{[a-zA-Z+:]+\|[^}]*\}\}/g, '')                       // All remaining templates
		.replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, '$2')              // [[link]] or [[target|display]]
		.replace(/'''([^']+)'''/g, '$1')                              // Bold
		.replace(/''([^']+)''/g, '$1')                                // Italic
		.replace(/<[^>]+>/g, '')                                       // HTML tags
		.replace(/&[a-z]+;/gi, ' ')                                   // HTML entities
		.replace(/\|[a-zA-Z]+=/g, ' ')                                   // Named params like |notext=1, |passage=
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Extract etymology and IPA from raw wikitext source.
 */
function extractFromWikitext(
	wikitext: string,
): { etymology?: string; ipa?: string; forms?: Array<{ form: string; tags: string[] }> } {
	const result: { etymology?: string; ipa?: string; forms?: Array<{ form: string; tags: string[] }> } = {};

	const etymMatch = wikitext.match(/===+Etymology\s*\d*===+\s*([\s\S]*?)(?====|$)/i);
	if (etymMatch) {
		const raw = etymMatch[1].trim();
		const firstPara = raw.split(/\n===/)[0];
		result.etymology = stripWikitext(firstPara).slice(0, 500);
	}

	const ipaMatch = wikitext.match(/\{\{IPA\|([^}]+)\}\}/);
	if (ipaMatch) {
		const parts = ipaMatch[1].split('|').filter(p => p.startsWith('/'));
		if (parts.length > 0) {
			result.ipa = parts[0];
		}
	}

	if (!result.ipa) {
		const pronMatch = wikitext.match(/\{\{enPR\|([^}]+)\}\}/);
		if (pronMatch) {
			result.ipa = pronMatch[1];
		}
	}

	return result;
}

// ── Public API ───────────────────────────────────────────────────────────

export async function wiktionaryRestLookup(
	word: string,
): Promise<WiktionaryEntry | null> {
	const [def, wikitextPage] = await Promise.all([
		fetchDefinition(word),
		fetchWikitextSource(word),
	]);

	let metadata: { etymology?: string; ipa?: string; forms?: Array<{ form: string; tags: string[] }> } = {};
	if (wikitextPage?.source) {
		metadata = extractFromWikitext(wikitextPage.source);
	}

	const enSections = def?.en;
	if (enSections && enSections.length > 0) {
		return {
			word,
			...metadata,
			definitions: enSections.map((g) => ({
				partOfSpeech: g.partOfSpeech,
				definitions: g.definitions || [],
			})),
		};
	}

	if (metadata.etymology || metadata.ipa) {
		return {
			word,
			...metadata,
			definitions: [],
		};
	}

	return null;
}
