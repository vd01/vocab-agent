import { db } from '@/lib/db';
import { words } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import type { Extractor } from './registry';

export const collinsDistributionExtractor: Extractor = {
  name: 'collins-distribution',
  description: '词库中单词的 Collins 星级分布',
  async extract() {
    const rows = await db
      .select({
        collins: words.collins,
        count: sql<number>`count(*)`,
      })
      .from(words)
      .groupBy(words.collins);

    const distribution: Record<string, number> = {};
    for (const row of rows) {
      const key = row.collins ? `${row.collins}★` : '无星级';
      distribution[key] = row.count;
    }

    return { collinsDistribution: distribution };
  },
};
