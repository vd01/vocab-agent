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

  // ── Word Groups ──────────────────────────────────────────────────────────

  await client.execute(`
    CREATE TABLE IF NOT EXISTS word_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS word_group_members (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES word_groups(id),
      word_id TEXT NOT NULL REFERENCES words(id),
      added_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_wgm_group_id ON word_group_members(group_id);
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_wgm_word_id ON word_group_members(word_id);
  `);

  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wgm_unique ON word_group_members(group_id, word_id);
  `);

  // Seed default group "日常" and assign all existing words to it
  const nowSec = Math.floor(Date.now() / 1000);
  await client.execute({
    sql: `INSERT OR IGNORE INTO word_groups (id, name, description, is_default, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: ['default-daily', '日常', '默认分组', 1, nowSec],
  });

  // Assign all existing words to the default group (idempotent via UNIQUE index)
  await client.execute({
    sql: `
      INSERT OR IGNORE INTO word_group_members (id, group_id, word_id, added_at)
      SELECT 'wgm-' || w.id, 'default-daily', w.id, ?
      FROM words w
    `,
    args: [nowSec],
  });

  // ── User Settings ─────────────────────────────────────────────────────────

  await client.execute(`
    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // ── Migrate existing new words into the queue ──────────────────────────────
  // Words that have rating=0 (never reviewed) and due <= now are "new words"
  // that were created before the queue system existed. Move them into the
  // queue by setting their due to the sentinel value (year 2099).
  // They will be gradually released by releaseNewWords() per the daily quota.
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const queueDueSec = Math.floor(new Date('2099-12-31T23:59:59').getTime() / 1000);
    const result = await client.execute({
      sql: `
        UPDATE reviews SET due = ?
        WHERE rowid IN (
          SELECT r.rowid
          FROM reviews r
          INNER JOIN (
            SELECT word_id, max(reviewed_at) as max_reviewed_at
            FROM reviews
            GROUP BY word_id
          ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
          WHERE r.rating = 0 AND r.due <= ?
        )
      `,
      args: [queueDueSec, nowSec],
    });
    if (result.rowsAffected && result.rowsAffected > 0) {
      console.log(`Queued ${result.rowsAffected} existing new words for gradual release`);
    }
  } catch (err) {
    console.error('Failed to queue existing new words:', err);
  }

  console.log('Migrations complete!');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
