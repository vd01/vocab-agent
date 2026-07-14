import { type ToolSet } from 'ai';
import { developerModel } from './models';
import { buildDeveloperInstructions } from './prompts/developer-system';
import { fileReadTool } from './tools/file-write';
import { fileWriteGuidanceTool } from './tools/file-write-tool';
import { fileEditGuidanceTool } from './tools/file-edit-tool';
import { fileListTool } from './tools/file-list';
import { registerToolTool } from './tools/register-tool';
import { registerComponentTool } from './tools/register-component';
import { unregisterComponentTool } from './tools/unregister-component';
import { createCommandTool } from './tools/create-command';
import { dbQueryTool } from './tools/db-query';
import { saveLessonTool, loadDeveloperLessons } from './tools/save-lesson';
import { testCommandTool } from './tools/test-command';
import { listLessonsTool } from './tools/list-lessons';
import { mergeLessonsTool } from './tools/merge-lessons';
import type { WorldState } from '@/lib/pipeline/world-state';

// ── Developer Tool Set ───────────────────────────────────────────────────

export const developerTools = {
  'file-read': fileReadTool,
  'file-list': fileListTool,
  'file-write': fileWriteGuidanceTool,
  'file-edit': fileEditGuidanceTool,
  'create-command': createCommandTool,
  'register-tool': registerToolTool,
  'register-component': registerComponentTool,
  'unregister-component': unregisterComponentTool,
  'db-query': dbQueryTool,
  'save-lesson': saveLessonTool,
  'list-lessons': listLessonsTool,
  'merge-lessons': mergeLessonsTool,
  'test-command': testCommandTool,
} satisfies ToolSet;

export type DeveloperTools = typeof developerTools;

// ── Developer Config ─────────────────────────────────────────────────────

export async function getDeveloperConfig(worldState: WorldState) {
  const lessons = await loadDeveloperLessons();

  return {
    model: developerModel,
    instructions: buildDeveloperInstructions(lessons, worldState),
    tools: developerTools,
    maxTokens: 16384,
    temperature: 0.1,
  };
}
