import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'vocab.db');

const client = createClient({
  url: `file:${dbPath}`,
});

async function reset() {
  console.log('Resetting database to initial state...');

  // Drop all tables (order matters for foreign keys)
  const tables = [
    'reviews',
    'words',
    'chat_messages',
    'dynamic_commands',
    'dynamic_extractors',
    'developer_lessons',
  ];

  for (const table of tables) {
    await client.execute(`DROP TABLE IF EXISTS ${table}`);
    console.log(`  Dropped ${table}`);
  }

  // Drop indexes
  const indexes = ['idx_reviews_word_id', 'idx_reviews_due'];
  for (const idx of indexes) {
    await client.execute(`DROP INDEX IF EXISTS ${idx}`);
    console.log(`  Dropped index ${idx}`);
  }

  // Re-run migrations (same as migrate.ts)
  console.log('\nRe-creating tables...');

  await client.execute(`
    CREATE TABLE words (
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
  console.log('  Created words');

  await client.execute(`
    CREATE TABLE reviews (
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

  await client.execute(`CREATE INDEX idx_reviews_word_id ON reviews(word_id)`);
  await client.execute(`CREATE INDEX idx_reviews_due ON reviews(due)`);
  console.log('  Created indexes');

  await client.execute(`
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      parts TEXT,
      agent_type TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  console.log('  Created chat_messages');

  await client.execute(`
    CREATE TABLE dynamic_commands (
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
    CREATE TABLE dynamic_extractors (
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
    CREATE TABLE developer_lessons (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  console.log('  Created developer_lessons');

  console.log('\nDatabase reset complete!');
  process.exit(0);
}

reset().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
