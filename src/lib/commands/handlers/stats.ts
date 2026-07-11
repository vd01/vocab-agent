/**
 * /stats command — show learning statistics.
 * Reuses getProficiencyDistribution and getDailyStats from scheduler.
 */

import { getProficiencyDistribution, getDailyStats } from '@/lib/fsrs/scheduler';
import { db } from '@/lib/db';
import { words } from '@/lib/db/schema';
import { count } from 'drizzle-orm';
import type { CommandHandler, CommandResult } from '../executor';

export const statsHandler: CommandHandler = {
  name: 'stats',
  description: '查看学习统计',
  usage: '/stats',

  async execute(_args: string[]): Promise<CommandResult> {
    const [distribution, daily, totalWords] = await Promise.all([
      getProficiencyDistribution(),
      getDailyStats(),
      db.select({ count: count() }).from(words),
    ]);

    const total = totalWords[0]?.count ?? 0;

    return {
      type: 'stats',
      totalWords: total,
      distribution,
      daily: {
        reviewed: daily.reviewed,
        correctRate: Math.round(daily.correctRate * 100),
      },
    };
  },
};
