/**
 * 一键清空所有用户数据，保留 ECDICT 源库文件 (data/ecdict.db)
 *
 * 清空范围：
 * - DB 表（全量 DELETE）: words, reviews, chat_messages, dynamic_commands,
 *   dynamic_extractors, developer_lessons, pinned_words,
 *   word_group_members, word_groups, user_settings
 * - 文件: generated/ 递归删除
 * - 文件: src/components/generated/ 内容清空（保留目录）
 * - 文件: component-registry.ts 重置为空模板
 *
 * 不清空: data/ecdict.db（ECDICT 源库，可随时重新 seed-words）
 */
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
const client = createClient({ url: `file:${dbPath}` });

const GENERATED_DIR = path.join(process.cwd(), 'generated');
const COMPONENTS_DIR = path.join(process.cwd(), 'src', 'components', 'generated');
const REGISTRY_PATH = path.join(process.cwd(), 'src', 'components', 'generative', 'component-registry.ts');

// ── 需要全量清空的表 ──────────────────────────────────────────────────────
const FULL_DELETE_TABLES = [
  'word_group_members',  // 先删子表（外键依赖）
  'word_groups',
  'pinned_words',
  'reviews',
  'words',               // words 也要全清，ecdict.db 源库不受影响
  'chat_messages',
  'dynamic_commands',
  'dynamic_extractors',
  'developer_lessons',
  'user_settings',
];

// ── 空注册表模板 ──────────────────────────────────────────────────────────
const EMPTY_REGISTRY = `'use client';

import React from 'react';

type ComponentMap = Map<string, React.ComponentType<Record<string, unknown>>>;

class ComponentRegistryClass {
  private components: ComponentMap = new Map();

  register(name: string, component: React.ComponentType<Record<string, unknown>>): void {
    this.components.set(name, component);
  }

  get(name: string): React.ComponentType<Record<string, unknown>> | undefined {
    return this.components.get(name);
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  getAll(): Map<string, React.ComponentType<Record<string, unknown>>> {
    return new Map(this.components);
  }

  unregister(name: string): void {
    this.components.delete(name);
  }
}

// Singleton instance — use globalThis to survive HMR module replacement
const GLOBAL_KEY = '__vocab_component_registry__' as const;

if (!(globalThis as any)[GLOBAL_KEY]) {
  (globalThis as any)[GLOBAL_KEY] = new ComponentRegistryClass();
}

export const componentRegistry: ComponentRegistryClass = (globalThis as any)[GLOBAL_KEY];

/**
 * Load all generated components using dynamic imports.
 * This file is auto-updated by the register-component / unregister-component tools
 * whenever a component is added or removed. The file change triggers Turbopack HMR,
 * which compiles the new components and hot-reloads this module.
 *
 * Uses dynamic import() instead of static imports so that:
 * - Build succeeds when generated/ is empty (git clone, clean:dynamic)
 * - No hardcoded static imports that would break on missing files
 *
 * DO NOT EDIT MANUALLY — changes will be overwritten.
 */

export function loadGeneratedComponents() {
  // No components registered yet
}
`;

async function purgeAll() {
  console.log('🗑️  Purging all user data (preserving ECDICT)...\n');

  // ── 1. 清空全量 DELETE 表 ─────────────────────────────────────────────
  console.log('[1/5] Clearing database tables (full delete)...');
  for (const table of FULL_DELETE_TABLES) {
    try {
      const result = await client.execute(`DELETE FROM ${table}`);
      console.log(`  ${table}: ${result.rowsAffected} rows deleted`);
    } catch (err) {
      console.error(`  ⚠ ${table}:`, (err as Error).message);
    }
  }

  // ── 2. 删除 generated/ 目录 ──────────────────────────────────────────
  console.log('\n[2/6] Removing generated/ directory...');
  if (fs.existsSync(GENERATED_DIR)) {
    fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
    console.log('  ✓ generated/ removed');
  } else {
    console.log('  (generated/ does not exist, skipped)');
  }

  // ── 3. 清空 src/components/generated/ 内容 ────────────────────────────
  console.log('\n[3/6] Cleaning src/components/generated/...');
  if (fs.existsSync(COMPONENTS_DIR)) {
    const entries = fs.readdirSync(COMPONENTS_DIR);
    for (const entry of entries) {
      const entryPath = path.join(COMPONENTS_DIR, entry);
      fs.rmSync(entryPath, { recursive: true, force: true });
    }
    console.log(`  ✓ ${entries.length} items removed, directory preserved`);
  } else {
    fs.mkdirSync(COMPONENTS_DIR, { recursive: true });
    console.log('  (directory created)');
  }

  // ── 4. 重置 component-registry.ts ─────────────────────────────────────
  console.log('\n[4/6] Resetting component-registry.ts...');
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, EMPTY_REGISTRY, 'utf-8');
  console.log('  ✓ Registry reset to empty template');

  // ── 5. 重建默认分组 & 分配关系 ────────────────────────────────────────
  console.log('\n[5/6] Rebuilding default word group...');
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    await client.execute({
      sql: `INSERT OR IGNORE INTO word_groups (id, name, description, is_default, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: ['default-daily', '日常', '默认分组', 1, nowSec],
    });
    // 将所有保留的词分配到默认分组
    const assignResult = await client.execute({
      sql: `INSERT OR IGNORE INTO word_group_members (id, group_id, word_id, added_at)
           SELECT 'wgm-' || w.id, 'default-daily', w.id, ?
           FROM words w`,
      args: [nowSec],
    });
    console.log(`  ✓ Default group created, ${assignResult.rowsAffected} words assigned`);
  } catch (err) {
    console.error('  ⚠ word_groups:', (err as Error).message);
  }

  // ── 6. 为保留的 ECDICT 词重建 FSRS review 记录 ────────────────────────
  console.log('\n[6/6] Rebuilding FSRS review records for preserved words...');
  try {
    const QUEUE_DUE_SEC = Math.floor(new Date('2099-12-31T23:59:59').getTime() / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const crypto = await import('crypto');

    // 获取没有 review 记录的词
    const orphans = await client.execute(`
      SELECT w.id FROM words w
      LEFT JOIN reviews r ON r.word_id = w.id
      WHERE r.id IS NULL
    `);

    if (orphans.rows.length > 0) {
      await client.execute('BEGIN TRANSACTION');
      try {
        for (const row of orphans.rows) {
          const wordId = row.id as string;
          const id = crypto.randomUUID();
          await client.execute({
            sql: `INSERT INTO reviews (id, word_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review, reviewed_at)
                  VALUES (?, ?, 0, 0, ?, 0, 0, 0, 0, 0, 0, ?, ?)`,
            args: [id, wordId, QUEUE_DUE_SEC, nowSec, nowSec],
          });
        }
        await client.execute('COMMIT');
        console.log(`  ✓ Created ${orphans.rows.length} FSRS review records (queued for gradual release)`);
      } catch {
        await client.execute('ROLLBACK');
        console.error('  ⚠ Failed to create review records (transaction rolled back)');
      }
    } else {
      console.log('  (all words already have review records)');
    }
  } catch (err) {
    console.error('  ⚠ reviews rebuild:', (err as Error).message);
  }

  // ── 7. 通知 Next.js 进程重置 pi session ──────────────────────────────
  console.log('\n[7/7] Notifying Next.js to reset pi session...');
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3088';
    const headers: Record<string, string> = {};
    // Pass AUTH_PASSWORD for server-side auth (X-Auth-Password header)
    if (process.env.AUTH_PASSWORD) {
      headers['X-Auth-Password'] = process.env.AUTH_PASSWORD;
    }
    const res = await fetch(`${baseUrl}/api/messages`, { method: 'DELETE', headers });
    if (res.ok) {
      const data = await res.json();
      console.log(`  ✓ Pi session reset: ${data.message}`);
    } else {
      console.log('  ⚠ Pi session reset failed (dev server may not be running). Restart dev server to clear pi memory.');
    }
  } catch {
    console.log('  ⚠ Could not reach dev server. Restart dev server to clear pi session memory.');
  }

  // ── 最终统计 ──────────────────────────────────────────────────────────
  const finalWords = await client.execute('SELECT COUNT(*) as cnt FROM words');
  const finalReviews = await client.execute('SELECT COUNT(*) as cnt FROM reviews');
  console.log(`\n📊 Final state: ${Number((finalWords.rows[0] as any).cnt)} words, ${Number((finalReviews.rows[0] as any).cnt)} review records`);

  console.log('\n✅ Purge complete! All user data cleared. ECDICT source DB (ecdict.db) preserved.\n   Run `npm run seed-words` to re-import words.');
}

purgeAll().catch((err) => {
  console.error('Purge failed:', err);
  process.exit(1);
});
