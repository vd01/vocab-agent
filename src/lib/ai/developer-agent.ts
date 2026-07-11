import { type ToolSet } from 'ai';
import { developerModel } from './models';
import { buildDeveloperInstructions } from './prompts/developer-system';
import { fileWriteTool, fileReadTool } from './tools/file-write';
import { fileEditTool } from './tools/file-edit';
import { fileListTool } from './tools/file-list';
import { shellExecTool } from './tools/shell-exec';
import { registerToolTool } from './tools/register-tool';
import { registerComponentTool } from './tools/register-component';
import { unregisterComponentTool } from './tools/unregister-component';
import { createCommandTool } from './tools/create-command';
import { dbQueryTool } from './tools/db-query';
import { saveLessonTool, loadDeveloperLessons } from './tools/save-lesson';
import { testCommandTool } from './tools/test-command';

// ── Developer Tool Set ───────────────────────────────────────────────────

export const developerTools = {
  'file-write': fileWriteTool,
  'file-read': fileReadTool,
  'file-edit': fileEditTool,
  'file-list': fileListTool,
  'shell-exec': shellExecTool,
  'create-command': createCommandTool,
  'register-tool': registerToolTool,
  'register-component': registerComponentTool,
  'unregister-component': unregisterComponentTool,
  'db-query': dbQueryTool,
  'save-lesson': saveLessonTool,
  'test-command': testCommandTool,
} satisfies ToolSet;

export type DeveloperTools = typeof developerTools;

// ── Developer Config ─────────────────────────────────────────────────────

export async function getDeveloperConfig() {
  const lessons = await loadDeveloperLessons();

  return {
    model: developerModel,
    instructions: buildDeveloperInstructions(lessons),
    tools: developerTools,
  };
}
