import { defineTool } from './types';
import { z } from 'zod';
import { lookupWord } from '@/lib/dictionary/lookup';

/**
 * Pure dictionary lookup tool — for Teacher Agent.
 * Does NOT interact with the user's vocab library.
 * Use vocab-lookup if you need to check the user's library.
 */
export const dictLookupTool = defineTool({
  description: '查词典获取单词的详细信息（音标、中英文释义、例句、同义词、词频、考试标签等）。不涉及用户词库，纯词典查询。',
  inputSchema: z.object({
    word: z.string().describe('要查询的单词'),
  }),
  execute: async ({ word }) => {
    const entry = await lookupWord(word.toLowerCase());

    if (!entry) {
      return { type: 'not-found', word, message: `词典中未找到单词 "${word}"` };
    }

    return {
      type: 'dict-found',
      word: entry.word,
      phonetic: entry.phonetic,
      translation: entry.translation,
      definitions: entry.definitions,
      collins: entry.collins,
      tag: entry.tag,
      bnc: entry.bnc,
      frq: entry.frq,
      exchange: entry.exchange,
      audioUrl: entry.audioUrl,
      synonyms: entry.synonyms,
      antonyms: entry.antonyms,
      origin: entry.origin,
      source: entry.source,
    };
  },
});
