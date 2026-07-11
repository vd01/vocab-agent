import { join } from 'path';
import { tmpdir } from 'os';
import { readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, existsSync } from 'fs';

/**
 * File-based store for LLM debug logs.
 * Shared across API routes — avoids Next.js dev mode module re-instantiation issues.
 *
 * Temporary research tool — entries auto-expire after 5 minutes.
 */

const DEBUG_DIR = join(tmpdir(), 'vocab-agent-debug');

function ensureDir(): void {
  try {
    if (!existsSync(DEBUG_DIR)) {
      mkdirSync(DEBUG_DIR, { recursive: true });
    }
  } catch {
    // Debug logs are non-critical; silently ignore directory creation failures
  }
}

function getDebugPath(id: string): string {
  return join(DEBUG_DIR, `${id}.json`);
}

export function setDebugLogs(id: string, logs: any[]): void {
  try {
    ensureDir();
    const path = getDebugPath(id);
    writeFileSync(path, JSON.stringify({ id, createdAt: Date.now(), logs }), 'utf-8');
  } catch {
    // Non-critical; ignore write failures
  }
}

export function getDebugLogs(id: string): { id: string; createdAt: number; logs: any[] } | null {
  const path = getDebugPath(id);
  try {
    const data = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(data);
    // Check expiry
    if (Date.now() - parsed.createdAt > 5 * 60 * 1000) {
      try { unlinkSync(path); } catch {}
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Cleanup expired entries on module load
try {
  ensureDir();
  const files = readdirSync(DEBUG_DIR);
  const now = Date.now();
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(DEBUG_DIR, file), 'utf-8'));
      if (now - data.createdAt > 5 * 60 * 1000) {
        try { unlinkSync(join(DEBUG_DIR, file)); } catch {}
      }
    } catch {}
  }
} catch {}
