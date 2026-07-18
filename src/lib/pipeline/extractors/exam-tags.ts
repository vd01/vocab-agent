import { db } from '../../db';
import { words } from '../../db/schema';
import { sql } from 'drizzle-orm';
import type { Extractor } from './registry';

export const examTagsExtractor: Extractor = {
  name: 'exam-tags',
  description: '词库中单词的考试标签分布（CET4/CET6/GRE/TOEFL等）',
  async extract() {
    const rows = await db
      .select({ tag: words.tag })
      .from(words)
      .where(sql`${words.tag} IS NOT NULL`);

    const distribution: Record<string, number> = {};
    for (const row of rows) {
      if (!row.tag) continue;
      const tags = row.tag.split(/\s+/).filter(Boolean);
      for (const t of tags) {
        distribution[t] = (distribution[t] || 0) + 1;
      }
    }

    return { examTagDistribution: distribution };
  },
};
