import { db } from '@/lib/db';
import { dynamicCommands } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getAllBuiltins } from './executor';

// Note: built-in handlers are registered in executor.ts on module load.
// This module provides the public query API for commands.

// ── Public API ───────────────────────────────────────────────────────────

export interface Command {
  name: string;
  description: string;
  usage: string;
  isBuiltin: boolean;
}

export async function getAllCommands(): Promise<Command[]> {
  const dynamicCmds = await db
    .select({ name: dynamicCommands.name, description: dynamicCommands.description })
    .from(dynamicCommands);

  return [
    ...getAllBuiltins().map(h => ({
      name: h.name,
      description: h.description,
      usage: h.usage,
      isBuiltin: true,
    })),
    ...dynamicCmds.map(c => ({
      name: c.name,
      description: c.description,
      usage: `/${c.name}`,
      isBuiltin: false,
    })),
  ];
}

export async function isCommand(name: string): Promise<boolean> {
  if (getAllBuiltins().some(c => c.name === name)) return true;
  const dynamic = await db
    .select({ name: dynamicCommands.name })
    .from(dynamicCommands)
    .where(eq(dynamicCommands.name, name))
    .limit(1);
  return dynamic.length > 0;
}
