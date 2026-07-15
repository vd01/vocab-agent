import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db';
import { words } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { lookupWord } from '@/lib/dictionary/lookup';

export const vocabLookupTool = tool({
  description: '查询单词详情。先查用户词库，未找到则自动查词典（ECDICT + 在线词典），返回音标、释义、例句等丰富信息。',
  inputSchema: z.object({
    word: z.string().describe('要查询的单词'),
  }),
  execute: async ({ word }) => {
    const normalized = word.toLowerCase();

    // 1. Check user's vocab library first
    const result = await db
      .select()
      .from(words)
      .where(eq(words.word, normalized))
      .limit(1);

    if (result.length > 0) {
      const w = result[0];
      return {
        type: 'found',
        wordId: w.id,
        word: w.word,
        phonetic: w.phonetic,
        audioUrl: w.audioUrl,
        definition: w.definition,
        examples: w.examples,
        source: w.source,
        tag: w.tag,
        collins: w.collins,
        bnc: w.bnc,
        exchange: w.exchange,
      };
    }

    // 2. Not in user library — look up from dictionaries
    const dictEntry = await lookupWord(normalized);

    if (dictEntry) {
      return {
        type: 'dict-found',
        word: dictEntry.word,
        phonetic: dictEntry.phonetic,
        translation: dictEntry.translation,
        definitions: dictEntry.definitions,
        collins: dictEntry.collins,
        tag: dictEntry.tag,
        bnc: dictEntry.bnc,
        frq: dictEntry.frq,
        exchange: dictEntry.exchange,
        audioUrl: dictEntry.audioUrl,
        synonyms: dictEntry.synonyms,
        antonyms: dictEntry.antonyms,
        source: dictEntry.source,
        hint: '该单词不在你的词库中，可以用 add-word 添加',
      };
    }

    return { type: 'not-found', word, message: `词库和词典中均未找到单词 "${word}"` };
  },
});
