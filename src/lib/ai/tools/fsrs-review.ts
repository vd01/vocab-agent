import { tool } from 'ai';
import { z } from 'zod';
import { getDueWords, processReview, Rating } from '@/lib/fsrs/scheduler';

export const fsrsReviewTool = tool({
  description: '获取待复习的单词列表，用于 FSRS 间隔重复复习',
  inputSchema: z.object({
    limit: z.number().optional().describe('获取的单词数量，默认 5'),
  }),
  execute: async ({ limit = 5 }) => {
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
        definition: w.definition,
        examples: w.examples,
        pinned: w.pinned,
      })),
    };
  },
});

export const fsrsRateTool = tool({
  description: '对单词进行 FSRS 评分，更新复习调度',
  inputSchema: z.object({
    wordId: z.string().describe('单词 ID'),
    rating: z.number().min(1).max(4).describe('评分: 1=Again, 2=Hard, 3=Good, 4=Easy'),
  }),
  execute: async ({ wordId, rating }) => {
    const result = await processReview(wordId, rating as Rating);
    const ratingNames: Record<number, string> = {
      1: 'Again',
      2: 'Hard',
      3: 'Good',
      4: 'Easy',
    };
    return {
      type: 'review-result',
      rating: ratingNames[rating],
      nextDue: result.card.due.toISOString(),
      scheduledDays: result.card.scheduled_days,
      state: result.card.state,
    };
  },
});
