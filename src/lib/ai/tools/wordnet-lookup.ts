import { defineTool } from './types';
import { z } from 'zod';
import { wordnetLookup } from '../../dictionary/wordnet';
import { wordDebugger } from '../../debug/word-debug';

/**
 * WordNet lookup tool — for Teacher Agent.
 * Provides synsets (word meanings grouped by part of speech),
 * semantic relations (hypernyms/hyponyms), and lemmas.
 * Use this when users ask about word senses, synonyms in context,
 * "is-a" relationships, or want to explore word families.
 */
export const wordnetLookupTool = defineTool({
	description:
		'查 WordNet 获取单词的语义分类（synsets）、上下位关系（hypernyms/hyponyms）和词形变化。用于了解词义层次、同义辨析、词汇扩展。',
	inputSchema: z.object({
		word: z.string().describe('要查询的单词'),
	}),
	execute: async ({ word }) => {
		const normalized = word.toLowerCase();

		// Debug: start tracking (may already be tracked from vocab-lookup)
		wordDebugger.startWord(normalized);

		const startMs = Date.now();
		const result = await wordnetLookup(normalized);
		const durationMs = Date.now() - startMs;

		if (!result) {
			wordDebugger.recordSource(normalized, 'wordnet', null, durationMs);
			return {
				type: 'not-found',
				word,
				message: `WordNet 中未找到单词 "${word}"`,
			};
		}

		const toolResult = {
			type: 'wordnet-found',
			word: normalized,
			synsets: result.synsets.map((s) => ({
				pos: s.pos,
				definition: s.definition,
				lemmas: s.lemmas,
				examples: s.examples,
			})),
			semanticRelations: result.relations,
			synsetCount: result.synsets.length,
		};

		wordDebugger.recordSource(normalized, 'wordnet', toolResult, durationMs);

		return toolResult;
	},
});
