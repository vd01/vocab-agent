/**
 * /rate command — rate a word during FSRS review.
 * Usage: /rate <wordId> <rating>
 */

import { processReview, Rating } from '../../fsrs/scheduler';
import type { CommandHandler, CommandResult } from '../executor';

const RATING_NAMES: Record<number, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
};

export const rateHandler: CommandHandler = {
  name: 'rate',
  description: '对单词进行 FSRS 评分',
  usage: '/rate <wordId> <1-4>',

  async execute(args: string[]): Promise<CommandResult> {
    if (args.length < 2) {
      return { type: 'invalid-args', message: '用法: /rate <wordId> <1-4>' };
    }

    const wordId = args[0];
    const rating = parseInt(args[1], 10);

    if (isNaN(rating) || rating < 1 || rating > 4) {
      return { type: 'invalid-args', message: '评分必须是 1(Again) 2(Hard) 3(Good) 4(Easy)' };
    }

    try {
      const result = await processReview(wordId, rating as Rating);
      return {
        type: 'review-result',
        rating: RATING_NAMES[rating],
        nextDue: result.card.due.toISOString(),
        scheduledDays: result.card.scheduled_days,
        state: result.card.state,
      };
    } catch (err) {
      return {
        type: 'command-error',
        message: `评分失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
