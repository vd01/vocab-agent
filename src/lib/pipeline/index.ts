import { extractorRegistry } from './extractors/registry';
import { dueWordsExtractor } from './extractors/due-words';
import { proficiencyExtractor } from './extractors/proficiency';
import { dailyStatsExtractor } from './extractors/daily-stats';
import { vocabSummaryExtractor } from './extractors/vocab-summary';
import { examTagsExtractor } from './extractors/exam-tags';
import { collinsDistributionExtractor } from './extractors/collins-distribution';

// Register built-in extractors
extractorRegistry.register(dueWordsExtractor);
extractorRegistry.register(proficiencyExtractor);
extractorRegistry.register(dailyStatsExtractor);
extractorRegistry.register(vocabSummaryExtractor);
extractorRegistry.register(examTagsExtractor);
extractorRegistry.register(collinsDistributionExtractor);

export { extractorRegistry } from './extractors/registry';
