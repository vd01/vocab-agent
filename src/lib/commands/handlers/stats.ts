/**
 * /stats command — show learning statistics.
 * Reuses getProficiencyDistribution and getDailyStats from scheduler.
 *
 * Usage: /stats [分组名]
 *   /stats       — 全局统计
 *   /stats 四级  — 四级分组统计
 */

import { getProficiencyDistribution, getDailyStats } from '@/lib/fsrs/scheduler';
import { db } from '@/lib/db';
import { words, wordGroups, wordGroupMembers } from '@/lib/db/schema';
import { count, sql, eq } from 'drizzle-orm';
import type { CommandHandler, CommandResult } from '../executor';

export const statsHandler: CommandHandler = {
  name: 'stats',
  description: '查看学习统计 (如: /stats 或 /stats 四级)',
  usage: '/stats [分组名]',

  async execute(args: string[]): Promise<CommandResult> {
    const groupName = args[0]?.trim();

    // Resolve group name to groupId
    let groupId: string | null | undefined = undefined;
    let scopedGroup: string | null = null;
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
      scopedGroup = groupName;
    }

    const [distribution, daily, totalWords, groupRows, scopedWordCount] = await Promise.all([
      getProficiencyDistribution(groupId),
      getDailyStats(),
      db.select({ count: count() }).from(words),
      db.select({
        id: wordGroups.id,
        name: wordGroups.name,
        isDefault: wordGroups.isDefault,
        wordCount: sql<number>`COUNT(${wordGroupMembers.id})`,
      }).from(wordGroups)
        .leftJoin(wordGroupMembers, eq(wordGroups.id, wordGroupMembers.groupId))
        .groupBy(wordGroups.id)
        .orderBy(wordGroups.isDefault, wordGroups.name),
      // If scoped to a group, get that group's word count
      groupId
        ? db.select({ count: count() })
            .from(wordGroupMembers)
            .where(eq(wordGroupMembers.groupId, groupId))
        : Promise.resolve([{ count: 0 }]),
    ]);

    const total = groupId ? (scopedWordCount[0]?.count ?? 0) : (totalWords[0]?.count ?? 0);

    return {
      type: 'stats',
      group: scopedGroup,
      totalWords: total,
      distribution,
      daily: {
        reviewed: daily.reviewed,
        correctRate: Math.round(daily.correctRate * 100),
      },
      groupDistribution: groupRows.map(g => ({
        id: g.id,
        name: g.name,
        isDefault: g.isDefault === 1,
        wordCount: g.wordCount,
      })),
    };
  },
};
