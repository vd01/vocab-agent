import { client } from '@/lib/db';
import type { Extractor } from './registry';

function toUnixSec(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export const dueWordsExtractor: Extractor = {
  name: 'due-words',
  description: '今日待复习单词数量（基于每个词的最新 review 记录）',
  async extract() {
    // Use getDailyQueueInfo which includes release logic
    const { getDailyQueueInfo } = await import('@/lib/fsrs/scheduler');
    const queueInfo = await getDailyQueueInfo();

    return {
      dueCount: queueInfo.newDue + queueInfo.reviewDue,
      newQueued: queueInfo.newQueued,
    };
  },
};
