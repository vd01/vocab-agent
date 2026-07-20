import { defineTool } from './types';
import { z } from 'zod';
import { wiktionaryLookup } from '../../dictionary/wiktionary';
import { wordDebugger } from '../../debug/word-debug';

/**
 * Wiktionary lookup tool — for Teacher Agent.
 * Provides etymology, word forms (inflections/conjugations), and definitions.
 * Use this when users ask about word origins, historical development,
 * or detailed inflectional forms.
 */
export const wiktionaryLookupTool = defineTool({
	description:
		'查 Wiktionary 获取详细词源（etymology）、词形变化表（forms）、多地区发音（IPA）和释义。用于词源探究、变位查询、详细释义。',
	inputSchema: z.object({
		word: z.string().describe('要查询的单词'),
	}),
	execute: async ({ word }) => {
		const normalized = word.toLowerCase();

		// Debug: start tracking (may already be tracked from vocab-lookup)
		wordDebugger.startWord(normalized);

		const startMs = Date.now();
		const entry = await wiktionaryLookup(normalized);
		const durationMs = Date.now() - startMs;

		if (!entry) {
			wordDebugger.recordSource(normalized, 'wiktionary', null, durationMs);
			return {
				type: 'not-found',
				word,
				message: `Wiktionary 中未找到单词 "${word}"`,
			};
		}

		const toolResult = {
			type: 'wiktionary-found',
			word: entry.word ?? normalized,
			definitions: entry.definitions ?? [],
			etymology: entry.etymology ?? null,
			forms: entry.forms ?? [],
			ipa: entry.ipa ?? [],
			source: entry.source,
		};

		wordDebugger.recordSource(normalized, 'wiktionary', toolResult, durationMs);

		return toolResult;
	},
});
