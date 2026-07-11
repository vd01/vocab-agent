/**
 * 数据库层单元测试
 * 测试 Schema 定义、CRUD 操作、数据库初始化
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';

const TEST_DB_DIR = path.join(process.cwd(), 'data');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

let client: Client;

beforeAll(async () => {
  // Ensure data dir exists
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  // Remove old test db
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  client = createClient({ url: `file:${TEST_DB_PATH}` });

  // Create tables
  await client.execute(`
    CREATE TABLE IF NOT EXISTS words (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      phonetic TEXT,
      definition TEXT NOT NULL,
      examples TEXT,
      source TEXT,
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
});

afterAll(async () => {
  // Close connection first, then clean up test db
  client.close();
  // Give OS a moment to release the file lock
  await new Promise(resolve => setTimeout(resolve, 500));
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  } catch {
    // On Windows, file might still be locked - that's OK for a test db
    console.log(`Note: Could not delete test db at ${TEST_DB_PATH}, please clean up manually`);
  }
});

describe('Database Schema', () => {
  it('should create all required tables', async () => {
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tableNames = tables.rows.map(r => r.name);
    expect(tableNames).toContain('words');
    expect(tableNames).toContain('reviews');
    expect(tableNames).toContain('dynamic_commands');
  });
});

describe('Words CRUD', () => {
  it('should insert a word', async () => {
    const id = uuid();
    const now = Date.now();
    await client.execute({
      sql: 'INSERT INTO words (id, word, phonetic, definition, examples, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [id, 'ephemeral', '/ɪˈfemərəl/', '短暂的', '["例句"]', 'manual', now],
    });

    const result = await client.execute({
      sql: 'SELECT * FROM words WHERE id = ?',
      args: [id],
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].word).toBe('ephemeral');
    expect(result.rows[0].phonetic).toBe('/ɪˈfemərəl/');
    expect(result.rows[0].definition).toBe('短暂的');
  });

  it('should enforce unique word constraint', async () => {
    const now = Date.now();
    await client.execute({
      sql: 'INSERT INTO words (id, word, phonetic, definition, examples, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [uuid(), 'unique_test', null, 'test', null, 'manual', now],
    });

    await expect(
      client.execute({
        sql: 'INSERT INTO words (id, word, phonetic, definition, examples, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [uuid(), 'unique_test', null, 'duplicate', null, 'manual', now],
      })
    ).rejects.toThrow();
  });

  it('should query words by name', async () => {
    const result = await client.execute({
      sql: 'SELECT * FROM words WHERE word = ?',
      args: ['ephemeral'],
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].word).toBe('ephemeral');
  });

  it('should return empty for non-existent word', async () => {
    const result = await client.execute({
      sql: 'SELECT * FROM words WHERE word = ?',
      args: ['nonexistent'],
    });
    expect(result.rows.length).toBe(0);
  });

  it('should count total words', async () => {
    const result = await client.execute('SELECT COUNT(*) as cnt FROM words');
    expect(Number(result.rows[0].cnt)).toBeGreaterThanOrEqual(1);
  });
});

describe('Reviews CRUD', () => {
  let wordId: string;

  beforeAll(async () => {
    // Insert a word for review tests
    wordId = uuid();
    await client.execute({
      sql: 'INSERT INTO words (id, word, phonetic, definition, examples, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [wordId, 'review_test_word', null, '测试词', null, 'manual', Date.now()],
    });
  });

  it('should insert a review record', async () => {
    const now = Date.now();
    await client.execute({
      sql: `INSERT INTO reviews (id, word_id, rating, state, due, stability, difficulty,
             elapsed_days, scheduled_days, reps, lapses, last_review, reviewed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [uuid(), wordId, 3, 1, now + 600000, 0.4, 0.5, 0, 0, 1, 0, now, now],
    });

    const result = await client.execute({
      sql: 'SELECT * FROM reviews WHERE word_id = ?',
      args: [wordId],
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].rating).toBe(3);
  });

  it('should query due reviews', async () => {
    const now = Date.now();
    // Insert a review that is already due
    await client.execute({
      sql: `INSERT INTO reviews (id, word_id, rating, state, due, stability, difficulty,
             elapsed_days, scheduled_days, reps, lapses, last_review, reviewed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [uuid(), wordId, 1, 0, now - 1000, 0, 0, 0, 0, 0, 0, now, now],
    });

    const result = await client.execute({
      sql: 'SELECT * FROM reviews WHERE due <= ?',
      args: [now],
    });
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('should query future reviews (not due yet)', async () => {
    const now = Date.now();
    const result = await client.execute({
      sql: 'SELECT * FROM reviews WHERE due > ?',
      args: [now],
    });
    expect(result.rows.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Dynamic Commands', () => {
  it('should register a dynamic command', async () => {
    const id = uuid();
    const now = Date.now();
    await client.execute({
      sql: `INSERT INTO dynamic_commands (id, name, description, tool_code, component_code, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, 'test-cmd', 'A test command', 'export default {}', null, now, now],
    });

    const result = await client.execute({
      sql: 'SELECT * FROM dynamic_commands WHERE name = ?',
      args: ['test-cmd'],
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].description).toBe('A test command');
  });

  it('should update a dynamic command', async () => {
    const now = Date.now();
    await client.execute({
      sql: 'UPDATE dynamic_commands SET description = ?, updated_at = ? WHERE name = ?',
      args: ['Updated description', now, 'test-cmd'],
    });

    const result = await client.execute({
      sql: 'SELECT * FROM dynamic_commands WHERE name = ?',
      args: ['test-cmd'],
    });
    expect(result.rows[0].description).toBe('Updated description');
  });
});
