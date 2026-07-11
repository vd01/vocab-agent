/**
 * In-memory store for LLM debug logs.
 * Shared across API routes so /api/chat can write and /api/debug-logs can read.
 *
 * Temporary research tool — entries auto-expire after 5 minutes.
 */

export interface DebugLogEntry {
  logs: any[];
  createdAt: number;
}

export const debugStore = new Map<string, DebugLogEntry>();

// Cleanup expired entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of debugStore) {
    if (now - val.createdAt > 5 * 60 * 1000) debugStore.delete(key);
  }
}, 60_000);
