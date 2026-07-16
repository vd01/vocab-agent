import { defineTool } from './types';
import { z } from 'zod';
import { getDueWords, processReview, Rating } from '@/lib/fsrs/scheduler';
import { db } from '@/lib/db';
import { wordGroups } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const fsrsReviewTool = defineTool({
  description: '获取待复习的单词列表，用于 FSRS 间隔重复复习。可指定分组名只复习该分组的单词。',
  inputSchema: z.object({
    limit: z.number().optional().describe('获取的单词数量，默认 5'),
    group: z.string().optional().describe('分组名称，如"四级"、"考研"。不指定则复习所有分组'),
  }),
  execute: async ({ limit = 5, group }) => {
    // Resolve group name to groupId
    let groupId: string | null | undefined = undefined;
    if (group?.trim()) {
      const g = await db
        .select({ id: wordGroups.id })
        .from(wordGroups)
        .where(eq(wordGroups.name, group.trim()))
        .limit(1);
      if (g.length === 0) {
        return { type: 'error', message: `分组"${group}"不存在` };
      }
      groupId = g[0].id;
    }

    const dueWords = await getDueWords(limit, groupId);
    if (dueWords.length === 0) {
      const { getDailyQueueInfo } = await import('@/lib/fsrs/scheduler');
      const queueInfo = await getDailyQueueInfo(groupId);
      return {
        type: 'no-due-words',
        message: group ? `分组"${group}"中没有待复习的单词！` : '当前没有待复习的单词！',
        queueInfo: {
          newDue: queueInfo.newDue,
          reviewDue: queueInfo.reviewDue,
          newQueued: queueInfo.newQueued,
          todayNewReviewed: queueInfo.todayNewReviewed,
          todayReviewReviewed: queueInfo.todayReviewReviewed,
          dailyNewLimit: queueInfo.dailyNewLimit,
          dailyReviewLimit: queueInfo.dailyReviewLimit,
          newRemaining: queueInfo.newRemaining,
          reviewRemaining: queueInfo.reviewRemaining,
        },
      };
    }

    const { getDailyQueueInfo } = await import('@/lib/fsrs/scheduler');
    const queueInfo = await getDailyQueueInfo(groupId);

    return {
      type: 'due-words',
      group: group || null,
      words: dueWords.map(w => ({
        wordId: w.wordId,
        word: w.word,
        phonetic: w.phonetic,
        definition: w.definition,
        examples: w.examples,
        pinned: w.pinned,
        isNew: w.isNew,
      })),
      queueInfo: {
        newDue: queueInfo.newDue,
        reviewDue: queueInfo.reviewDue,
        newQueued: queueInfo.newQueued,
        todayNewReviewed: queueInfo.todayNewReviewed,
        todayReviewReviewed: queueInfo.todayReviewReviewed,
        dailyNewLimit: queueInfo.dailyNewLimit,
        dailyReviewLimit: queueInfo.dailyReviewLimit,
        newRemaining: queueInfo.newRemaining,
        reviewRemaining: queueInfo.reviewRemaining,
      },
    };
  },
});

export const fsrsRateTool = defineTool({
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
