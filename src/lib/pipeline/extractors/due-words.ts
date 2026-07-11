import { client } from '@/lib/db';
import type { Extractor } from './registry';

function toUnixSec(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export const dueWordsExtractor: Extractor = {
  name: 'due-words',
  description: '今日待复习单词数量（基于每个词的最新 review 记录）',
  async extract() {
    const nowSec = toUnixSec(new Date());

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

    const count = Number((result.rows[0] as any)?.cnt ?? 0);
    return { dueCount: count };
  },
};
