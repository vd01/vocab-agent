import { drizzle } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

function resolveDataDir(): string {
  const isElectron = typeof window !== 'undefined' ? !!window.electronAPI : !!process.env.ELECTRON_DEV || !!process.env.ELECTRON_PREVIEW;

  if (isElectron && process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      const dir = path.join(appData, 'vocab-agent', 'data');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      return dir;
    }
  }

  const dir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const dataDir = resolveDataDir();
const dbPath = path.join(dataDir, 'vocab.db');

export const client = createClient({
  url: `file:${dbPath}`,
});

export const db = drizzle(client, { schema });

export type Database = typeof db;
