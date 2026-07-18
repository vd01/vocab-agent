import { defineTool } from './types';
import { z } from 'zod';
import { db, client } from '../../db';
import { words, wordGroups, wordGroupMembers } from '../../db/schema';
import { sql, desc, eq } from 'drizzle-orm';
import { getProficiencyDistribution, getDailyStats } from '../../fsrs/scheduler';

/**
 * Vocab stats tool — returns detailed statistics about the user's vocabulary library.
 * Called when the user asks "我学了多少词", "词库统计", etc.
 */
export const vocabStatsTool = defineTool({
  description: '查询用户词库的详细统计信息，包括总量、考试标签分布、Collins星级分布、熟练度、学习天数等。当用户问"我学了多少词"、"词库统计"、"学习进度"时调用。',
  inputSchema: z.object({
    detail: z.boolean().optional().describe('是否显示详细信息，默认 false'),
  }),
  execute: async ({ detail = false }) => {
    // Run all queries in parallel
    const [
      totalResult,
      recentResult,
      proficiency,
      dailyStats,
      dueCountResult,
      tagRows,
      collinsRows,
      streakResult,
      groupRows,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(words),
      db.select({ word: words.word }).from(words).orderBy(desc(words.createdAt)).limit(5),
      getProficiencyDistribution(),
      getDailyStats(),
      computeDueCount(),
      db.select({ tag: words.tag }).from(words).where(sql`${words.tag} IS NOT NULL`),
      db.select({ collins: words.collins, count: sql<number>`count(*)` }).from(words).groupBy(words.collins),
      computeStreakDays(),
      db.select({
        id: wordGroups.id,
        name: wordGroups.name,
        isDefault: wordGroups.isDefault,
        wordCount: sql<number>`COUNT(${wordGroupMembers.id})`,
      }).from(wordGroups)
        .leftJoin(wordGroupMembers, eq(wordGroups.id, wordGroupMembers.groupId))
        .groupBy(wordGroups.id)
        .orderBy(wordGroups.isDefault, wordGroups.name),
    ]);

    // Process exam tags
    const examTagDistribution: Record<string, number> = {};
    for (const row of tagRows) {
      if (!row.tag) continue;
      const tags = row.tag.split(/\s+/).filter(Boolean);
      for (const t of tags) {
        examTagDistribution[t] = (examTagDistribution[t] || 0) + 1;
      }
    }

    // Process Collins distribution
    const collinsDistribution: Record<string, number> = {};
    for (const row of collinsRows) {
      const key = row.collins ? `${row.collins}★` : '无星级';
      collinsDistribution[key] = row.count;
    }

    return {
      type: 'vocab-stats',
      total: totalResult[0]?.count ?? 0,
      streakDays: streakResult,
      examTags: examTagDistribution,
      collinsDistribution,
      groupDistribution: groupRows.map(g => ({
        id: g.id,
        name: g.name,
        isDefault: g.isDefault === 1,
        wordCount: g.wordCount,
      })),
      proficiency,
      dailyStats: {
        reviewed: dailyStats.reviewed,
        correctRate: Math.round(dailyStats.correctRate * 100),
      },
      recentWords: recentResult.map(r => r.word),
      dueCount: dueCountResult,
    };
  },
});

async function computeDueCount(): Promise<number> {
  const nowSec = Math.floor(Date.now() / 1000);

  const result = await client.execute({
    sql: `
      SELECT COUNT(*) as cnt
      FROM reviews r
      INNER JOIN (
        SELECT word_id, max(reviewed_at) as max_reviewed_at
        FROM reviews
        GROUP BY word_id
      ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
      WHERE r.due <= ?
    `,
    args: [nowSec],
  });

  return Number((result.rows[0] as any)?.cnt ?? 0);
}

async function computeStreakDays(): Promise<number> {
  const rows = await client.execute({
    sql: `
      SELECT date(reviewed_at, 'unixepoch') as review_date
      FROM reviews
      WHERE rating > 0
      GROUP BY date(reviewed_at, 'unixepoch')
      ORDER BY review_date DESC
    `,
    args: [],
  });

  const dates = rows.rows.map(r => (r as any).review_date as string);
  if (dates.length === 0) return 0;

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  if (dates[0] !== todayStr && dates[0] !== yesterdayStr) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diffDays = Math.round((prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}
