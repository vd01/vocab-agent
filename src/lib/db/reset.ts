import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'vocab.db');

async function reset() {
  console.log('Resetting database to initial state...');

  // Close any existing connection by deleting the file
  // libsql uses WAL mode — we need to handle the lock files too
  const filesToDelete = [
    dbPath,
    dbPath + '-wal',
    dbPath + '-shm',
  ];

  for (const f of filesToDelete) {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
        console.log(`  Deleted ${path.basename(f)}`);
      } catch (err: any) {
        // If file is locked, try using the client to drop tables instead
        if (err.code === 'EBUSY' || err.code === 'EPERM') {
          console.log(`  File locked, falling back to DROP TABLE...`);
          await resetWithDrop();
          return;
        }
        throw err;
      }
    }
  }

  // Re-create database with all tables
  await createTables();
  console.log('\nDatabase reset complete!');
  process.exit(0);
}

async function resetWithDrop() {
  const client = createClient({ url: `file:${dbPath}` });

  // Disable foreign key checks to allow dropping in any order
  await client.execute('PRAGMA foreign_keys = OFF');

  // Drop all known tables (order doesn't matter with FK checks off)
  const tables = [
    'reviews',
    'pinned_words',
    'word_group_members',
    'word_groups',
    'words',
    'chat_messages',
    'dynamic_commands',
    'dynamic_extractors',
    'developer_lessons',
    'user_settings',
  ];

  for (const table of tables) {
    await client.execute(`DROP TABLE IF EXISTS ${table}`);
    console.log(`  Dropped ${table}`);
  }

  // Drop indexes
  const indexes = [
    'idx_reviews_word_id',
    'idx_reviews_due',
    'idx_wgm_unique',
  ];
  for (const idx of indexes) {
    await client.execute(`DROP INDEX IF EXISTS ${idx}`);
    console.log(`  Dropped index ${idx}`);
  }

  // Re-enable foreign keys
  await client.execute('PRAGMA foreign_keys = ON');

  // Re-create all tables
  await createTables();
}

async function createTables() {
  const client = createClient({ url: `file:${dbPath}` });

  console.log('\nCreating tables...');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS words (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      phonetic TEXT,
      audio_url TEXT,
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
  console.log('  Created words');

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
  console.log('  Created reviews');

  await client.execute(`CREATE INDEX IF NOT EXISTS idx_reviews_word_id ON reviews(word_id)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_reviews_due ON reviews(due)`);
  console.log('  Created review indexes');

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
  console.log('  Created chat_messages');

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
  console.log('  Created dynamic_commands');

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
  console.log('  Created dynamic_extractors');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS developer_lessons (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
  `);
  console.log('  Created developer_lessons');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS pinned_words (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES words(id),
      word TEXT NOT NULL,
      phonetic TEXT,
      audio_url TEXT,
      definition TEXT,
      position INTEGER NOT NULL,
      side TEXT NOT NULL,
      rich_content TEXT,
      created_at INTEGER NOT NULL,
      archived_at INTEGER
    );
  `);
  console.log('  Created pinned_words');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS word_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  console.log('  Created word_groups');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS word_group_members (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES word_groups(id),
      word_id TEXT NOT NULL REFERENCES words(id),
      added_at INTEGER NOT NULL
    );
  `);
  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wgm_unique ON word_group_members(group_id, word_id)`);
  console.log('  Created word_group_members');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  console.log('  Created user_settings');

  // Seed default group
  const { v4: uuid } = await import('uuid');
  await client.execute({
    sql: `INSERT OR IGNORE INTO word_groups (id, name, description, is_default, created_at) VALUES (?, '日常', '默认分组', 1, ?)`,
    args: [uuid(), Date.now()],
  });
  console.log('  Seeded default group "日常"');
}

reset().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
