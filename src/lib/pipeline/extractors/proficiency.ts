import { getProficiencyDistribution } from '@/lib/fsrs/scheduler';
import type { Extractor } from './registry';

export const proficiencyExtractor: Extractor = {
  name: 'proficiency',
  description: '熟练度分布概要',
  async extract() {
    const distribution = await getProficiencyDistribution();
    return { proficiency: distribution };
  },
};
