import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'vocab.db');

const client = createClient({
  url: `file:${dbPath}`,
});

async function migrate() {
  console.log('Running migrations...');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS words (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      phonetic TEXT,
      definition TEXT NOT NULL,
      examples TEXT,
      source TEXT,
      tag TEXT,
      collins INTEGER,
      bnc INTEGER,
      frq INTEGER,
      exchange TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES words(id),
      rating INTEGER NOT NULL,
      state INTEGER NOT NULL,
      due INTEGER NOT NULL,
      stability REAL NOT NULL,
      difficulty REAL NOT NULL,
      elapsed_days INTEGER NOT NULL,
      scheduled_days INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL,
      last_review INTEGER,
      reviewed_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_reviews_word_id ON reviews(word_id);
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_reviews_due ON reviews(due);
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      parts TEXT,
      agent_type TEXT,
      seq INTEGER NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
  `);

  // Add seq column to existing chat_messages table
  try {
    const cols = await client.execute(`PRAGMA table_info(chat_messages)`);
    const hasSeq = cols.rows.some((r: any) => r.name === 'seq');
    if (!hasSeq) {
      await client.execute(`ALTER TABLE chat_messages ADD COLUMN seq INTEGER`);
      // Assign seq values based on rowid order for existing rows
      await client.execute(`UPDATE chat_messages SET seq = rowid WHERE seq IS NULL`);
      // Make seq NOT NULL UNIQUE after backfill
      // SQLite doesn't support ALTER COLUMN, so we recreate if needed
      // For now, the app code will handle seq assignment
    }
  } catch {
    // Table might not exist yet, that's fine
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS dynamic_commands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      tool_code TEXT NOT NULL,
      component_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS dynamic_extractors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      script_code TEXT NOT NULL,
      output_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS developer_lessons (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS pinned_words (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES words(id),
      word TEXT NOT NULL,
      phonetic TEXT,
      definition TEXT,
      position INTEGER NOT NULL,
      side TEXT NOT NULL,
      rich_content TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_pinned_words_side ON pinned_words(side);
  `);

  console.log('Migrations complete!');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
