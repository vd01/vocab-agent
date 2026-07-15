import { extractorRegistry } from './index';

export interface WorldState {
  dueCount: number;
  newQueued: number;
  proficiency: { new: number; learning: number; review: number; relearning: number };
  dailyStats: { reviewed: number; correctRate: number };
  totalWords: number;
  streakDays: number;
  recentWords: string[];
  examTagDistribution: Record<string, number>;
  collinsDistribution: Record<string, number>;
  groups: Array<{ id: string; name: string; wordCount: number; isDefault: boolean }>;
}

/**
 * Build the World State by running all registered extractors
 * This is the concise JSON injected into the Agent's context
 */
export async function buildWorldState(): Promise<WorldState> {
  const extractors = extractorRegistry.getAll();

  // Run all extractors in parallel
  const results = await Promise.allSettled(
    extractors.map(e => e.extract()),
  );

  // Merge results
  const merged: Record<string, unknown> = {};
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      Object.assign(merged, result.value);
    } else {
      console.error(`Extractor ${extractors[i].name} failed:`, result.reason);
    }
  });

  return {
    dueCount: (merged.dueCount as number) ?? 0,
    newQueued: (merged.newQueued as number) ?? 0,
    proficiency: (merged.proficiency as WorldState['proficiency']) ?? { new: 0, learning: 0, review: 0, relearning: 0 },
    dailyStats: (merged.dailyStats as WorldState['dailyStats']) ?? { reviewed: 0, correctRate: 0 },
    totalWords: (merged.totalWords as number) ?? 0,
    streakDays: (merged.streakDays as number) ?? 0,
    recentWords: (merged.recentWords as string[]) ?? [],
    examTagDistribution: (merged.examTagDistribution as Record<string, number>) ?? {},
    collinsDistribution: (merged.collinsDistribution as Record<string, number>) ?? {},
    groups: (merged.groups as WorldState['groups']) ?? [],
  };
}
