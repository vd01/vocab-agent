import { drizzle } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

function resolveDataDir(): string {
  if (process.env.VOCAB_DATA_DIR) {
    if (!fs.existsSync(process.env.VOCAB_DATA_DIR)) {
      fs.mkdirSync(process.env.VOCAB_DATA_DIR, { recursive: true });
    }
    return process.env.VOCAB_DATA_DIR;
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
