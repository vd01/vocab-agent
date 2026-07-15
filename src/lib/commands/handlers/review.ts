/**
 * /review command — get due words for FSRS review.
 * Reuses the same logic as the fsrs-review tool.
 */

import { getDueWords } from '@/lib/fsrs/scheduler';
import type { CommandHandler, CommandResult } from '../executor';

export const reviewHandler: CommandHandler = {
  name: 'review',
  description: '开始 FSRS 复习',
  usage: '/review [数量]',

  async execute(args: string[]): Promise<CommandResult> {
    const limit = args[0] ? parseInt(args[0], 10) : 5;
    if (isNaN(limit) || limit < 1 || limit > 50) {
      return { type: 'invalid-args', message: '数量必须是 1-50 之间的整数' };
    }

    const dueWords = await getDueWords(limit);
    if (dueWords.length === 0) {
      return { type: 'no-due-words', message: '当前没有待复习的单词！' };
    }

    return {
      type: 'due-words',
      words: dueWords.map(w => ({
        wordId: w.wordId,
        word: w.word,
        phonetic: w.phonetic,
        audioUrl: w.audioUrl,
        definition: w.definition,
        examples: w.examples,
        pinned: w.pinned,
      })),
    };
  },
};
