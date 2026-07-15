import { createClient } from '@libsql/client';
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

  // Add audio_url column to existing words table (真人发音 MP3 URL)
  try {
    const cols = await client.execute(`PRAGMA table_info(words)`);
    const hasAudioUrl = cols.rows.some((r: any) => r.name === 'audio_url');
    if (!hasAudioUrl) {
      await client.execute(`ALTER TABLE words ADD COLUMN audio_url TEXT`);
    }
  } catch {
    // Table might not exist yet, that's fine
  }

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

  // Add last_used_at column to existing developer_lessons table
  try {
    const cols = await client.execute(`PRAGMA table_info(developer_lessons)`);
    const hasLastUsedAt = cols.rows.some((r: any) => r.name === 'last_used_at');
    if (!hasLastUsedAt) {
      await client.execute(`ALTER TABLE developer_lessons ADD COLUMN last_used_at INTEGER`);
    }
  } catch {
    // Table might not exist yet, that's fine
  }

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

  // Add archived_at column to existing pinned_words table
  try {
    const cols = await client.execute(`PRAGMA table_info(pinned_words)`);
    const hasArchivedAt = cols.rows.some((r: any) => r.name === 'archived_at');
    if (!hasArchivedAt) {
      await client.execute(`ALTER TABLE pinned_words ADD COLUMN archived_at INTEGER`);
    }
    // Add audio_url column to existing pinned_words table (denormalized from words)
    const hasAudioUrl = cols.rows.some((r: any) => r.name === 'audio_url');
    if (!hasAudioUrl) {
      await client.execute(`ALTER TABLE pinned_words ADD COLUMN audio_url TEXT`);
    }
  } catch {
    // Table might not exist yet, that's fine
  }

  console.log('Migrations complete!');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
