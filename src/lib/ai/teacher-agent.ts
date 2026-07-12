import { type ToolSet } from 'ai';
import { teacherModel } from './models';
import { buildTeacherInstructions } from './prompts/teacher-system';
import { fsrsReviewTool, fsrsRateTool } from './tools/fsrs-review';
import { vocabLookupTool } from './tools/vocab-lookup';
import { addWordTool } from './tools/add-word';
import { extractWordsTool } from './tools/extract-words';
import { dictLookupTool } from './tools/dict-lookup';
import { vocabStatsTool } from './tools/vocab-stats';
import { pinWordTool, unpinWordTool } from './tools/pin-word';
import type { WorldState } from '@/lib/pipeline/world-state';

// ── Teacher Tool Set ─────────────────────────────────────────────────────

export const teacherTools = {
  'fsrs-review': fsrsReviewTool,
  'fsrs-rate': fsrsRateTool,
  'vocab-lookup': vocabLookupTool,
  'add-word': addWordTool,
  'extract-words': extractWordsTool,
  'dict-lookup': dictLookupTool,
  'vocab-stats': vocabStatsTool,
  'pin-word': pinWordTool,
  'unpin-word': unpinWordTool,
} satisfies ToolSet;

export type TeacherTools = typeof teacherTools;

// ── Teacher Config ───────────────────────────────────────────────────────

export function getTeacherConfig(worldState: WorldState) {
  return {
    model: teacherModel,
    instructions: buildTeacherInstructions(worldState),
    tools: teacherTools,
  };
}
