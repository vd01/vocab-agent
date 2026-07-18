import { getDailyStats } from '../../fsrs/scheduler';
import type { Extractor } from './registry';

export const dailyStatsExtractor: Extractor = {
  name: 'daily-stats',
  description: '今日已复习数、正确率',
  async extract() {
    const stats = await getDailyStats();
    return { dailyStats: stats };
  },
};
