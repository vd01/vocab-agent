export type { Card } from 'ts-fsrs';
export { Rating, State } from 'ts-fsrs';

export interface DueWord {
  wordId: string;
  word: string;
  phonetic: string | null;
  definition: string;
  examples: string | null;
  card: import('ts-fsrs').Card;
}

export interface ProficiencyDistribution {
  new: number;
  learning: number;
  review: number;
  relearning: number;
}

export interface DailyStats {
  reviewed: number;
  correctRate: number;
}
