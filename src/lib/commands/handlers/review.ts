/**
 * /review command — get due words for FSRS review.
 * Reuses the same logic as the fsrs-review tool.
 *
 * Usage: /review [数量] [分组名]
 *   /review          — 复习 5 个单词
 *   /review 10       — 复习 10 个单词
 *   /review 5 四级   — 复习四级分组中 5 个单词
 *   /review 四级     — 复习四级分组中 5 个单词
 */

import { getDueWords } from '@/lib/fsrs/scheduler';
import { db } from '@/lib/db';
import { wordGroups } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { CommandHandler, CommandResult } from '../executor';

export const reviewHandler: CommandHandler = {
  name: 'review',
  description: '开始 FSRS 复习',
  usage: '/review [数量] [分组名]',

  async execute(args: string[]): Promise<CommandResult> {
    let limit = 5;
    let groupName: string | undefined;

    // Parse arguments: could be [number] [group] or [group]
    for (const arg of args) {
      const num = parseInt(arg, 10);
      if (!isNaN(num) && num >= 1 && num <= 50) {
        limit = num;
      } else {
        groupName = arg;
      }
    }

    // Resolve group name to groupId
    let groupId: string | null | undefined = undefined;
    if (groupName) {
      const group = await db
        .select({ id: wordGroups.id })
        .from(wordGroups)
        .where(eq(wordGroups.name, groupName))
        .limit(1);

      if (group.length === 0) {
        return { type: 'error', message: `分组"${groupName}"不存在` };
      }
      groupId = group[0].id;
    }

    const dueWords = await getDueWords(limit, groupId);
    if (dueWords.length === 0) {
      return {
        type: 'no-due-words',
        message: groupName ? `分组"${groupName}"中没有待复习的单词！` : '当前没有待复习的单词！',
      };
    }

    return {
      type: 'due-words',
      group: groupName || null,
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
