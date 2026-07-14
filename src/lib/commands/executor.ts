/**
 * Command executor — looks up and executes / commands without LLM involvement.
 * Built-in commands are registered here; dynamic commands are loaded from DB.
 */

import { db, client } from '@/lib/db';
import { dynamicCommands } from '@/lib/db/schema';
import { eq, and, or, not, gt, gte, lt, lte, inArray, like, sql, desc, asc, count } from 'drizzle-orm';

// ── Types ────────────────────────────────────────────────────────────────

export interface CommandResult {
  /** Reuses the same type strings as tool results so the frontend renderer works unchanged */
  type: string;
  [key: string]: any;
}

export interface CommandHandler {
  name: string;
  description: string;
  usage: string; // e.g. "/add <word> [definition]"
  execute(args: string[]): Promise<CommandResult>;
}

// ── Registry ─────────────────────────────────────────────────────────────

const builtinHandlers = new Map<string, CommandHandler>();

export function registerBuiltin(handler: CommandHandler) {
  builtinHandlers.set(handler.name, handler);
}

export function getBuiltin(name: string): CommandHandler | undefined {
  return builtinHandlers.get(name);
}

export function getAllBuiltins(): CommandHandler[] {
  return Array.from(builtinHandlers.values());
}

// ── Execution ────────────────────────────────────────────────────────────

export async function executeCommand(input: string): Promise<CommandResult> {
  const trimmed = input.trim();
  const [cmdName, ...args] = trimmed.slice(1).split(/\s+/); // strip leading /

  if (!cmdName) {
    return { type: 'unknown-command', message: '请输入命令名称' };
  }

  // 1. Check built-in commands
  const builtin = getBuiltin(cmdName);
  if (builtin) {
    return builtin.execute(args);
  }

  // 2. Check dynamic commands from DB
  const dynamic = await db
    .select()
    .from(dynamicCommands)
    .where(eq(dynamicCommands.name, cmdName))
    .limit(1);

  if (dynamic.length > 0) {
    return executeDynamicCommand(dynamic[0], args);
  }

  // 3. Not found — list available commands
  const dynamicNames = (await db.select({ name: dynamicCommands.name }).from(dynamicCommands)).map(r => r.name);
  const allNames = [...Array.from(builtinHandlers.keys()), ...dynamicNames];
  return { type: 'unknown-command', message: `未知命令 /${cmdName}，可用命令: ${allNames.join(', ')}` };
}

// ── Register built-in handlers ───────────────────────────────────────────

import { reviewHandler } from './handlers/review';
import { addHandler } from './handlers/add';
import { statsHandler } from './handlers/stats';
import { rateHandler } from './handlers/rate';
import { pinHandler } from './handlers/pin';

registerBuiltin(reviewHandler);
registerBuiltin(addHandler);
registerBuiltin(statsHandler);
registerBuiltin(rateHandler);
registerBuiltin(pinHandler);

// ── Dynamic command sandbox ──────────────────────────────────────────────

import { words, reviews, chatMessages, dynamicExtractors } from '@/lib/db/schema';

const DB_TABLES = { words, reviews, chatMessages, dynamicCommands, dynamicExtractors };

async function executeDynamicCommand(
  cmd: typeof dynamicCommands.$inferSelect,
  args: string[],
): Promise<CommandResult> {
  try {
    // Provide a restricted sandbox with whitelisted APIs
    const sandbox = {
      db,
      client,
      tables: DB_TABLES,
      dql: { eq, and, or, not, gt, gte, lt, lte, inArray, like, sql, desc, asc, count },
      fsrs: {
        getDueWords: (await import('@/lib/fsrs/scheduler')).getDueWords,
        processReview: (await import('@/lib/fsrs/scheduler')).processReview,
        initializeCard: (await import('@/lib/fsrs/scheduler')).initializeCard,
        getProficiencyDistribution: (await import('@/lib/fsrs/scheduler')).getProficiencyDistribution,
        getDailyStats: (await import('@/lib/fsrs/scheduler')).getDailyStats,
        Rating: (await import('@/lib/fsrs/scheduler')).Rating,
      },
      args,
      console: { log: console.log, error: console.error, warn: console.warn },
    };

    // Execute the tool_code in a sandboxed function
    // Inject db, client, tables, dql (operators), fsrs, args, console
    const fn = new Function(
      'db', 'client', 'tables', 'dql', 'fsrs', 'args', 'console',
      `"use strict"; return (${cmd.toolCode})(args)`,
    );

    const result = await fn(sandbox.db, sandbox.client, sandbox.tables, sandbox.dql, sandbox.fsrs, sandbox.args, sandbox.console);
    return result ?? { type: 'dynamic-result', message: '命令执行完成' };
  } catch (err) {
    console.error('[Dynamic Command Error]', err);
    return {
      type: 'command-error',
      message: `动态命令 /${cmd.name} 执行失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
