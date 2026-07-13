/**
 * 一键清理 Developer Agent 动态生成的所有内容
 * - DB 表: dynamic_commands + developer_lessons 清空
 * - 文件目录: generated/ 递归删除
 * - 文件目录: src/components/generated/ 递归删除（保留目录本身）
 * - 注册表: component-registry.ts 重置为空注册表
 */
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'vocab.db');
const client = createClient({ url: `file:${dbPath}` });

const GENERATED_DIR = path.join(process.cwd(), 'generated');
const COMPONENTS_DIR = path.join(process.cwd(), 'src', 'components', 'generated');
const REGISTRY_FILE = path.join(process.cwd(), 'src', 'components', 'generative', 'component-registry.ts');

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

// Singleton instance
export const componentRegistry = new ComponentRegistryClass();

/**
 * Load all generated components using static imports.
 * This file is auto-updated by the register-component tool
 * whenever a new component is registered. Turbopack HMR
 * will hot-reload this module automatically.
 *
 * DO NOT EDIT MANUALLY — changes will be overwritten.
 */

export function loadGeneratedComponents() {
  // No generated components registered yet
}
`;

async function cleanDynamic() {
  console.log('🧹 Cleaning Developer Agent dynamic content...\n');

  // 1. 清空 DB 表
  console.log('[1/4] Clearing database tables...');
  try {
    const cmdResult = await client.execute('DELETE FROM dynamic_commands');
    console.log(`  dynamic_commands: ${cmdResult.rowsAffected} rows deleted`);
  } catch (err) {
    console.error('  ⚠ dynamic_commands:', (err as Error).message);
  }

  try {
    const lessonResult = await client.execute('DELETE FROM developer_lessons');
    console.log(`  developer_lessons: ${lessonResult.rowsAffected} rows deleted`);
  } catch (err) {
    console.error('  ⚠ developer_lessons:', (err as Error).message);
  }

  // 2. 递归删除 generated/
  console.log('\n[2/4] Removing generated/ directory...');
  if (fs.existsSync(GENERATED_DIR)) {
    fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
    console.log('  ✓ generated/ removed');
  } else {
    console.log('  (generated/ does not exist, skipped)');
  }

  // 3. 递归删除 src/components/generated/ 内容，保留目录本身
  console.log('\n[3/4] Cleaning src/components/generated/...');
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

  // 4. 重置 component-registry.ts
  console.log('\n[4/4] Resetting component-registry.ts...');
  fs.writeFileSync(REGISTRY_FILE, EMPTY_REGISTRY, 'utf-8');
  console.log('  ✓ Registry reset to empty');

  console.log('\n✅ Clean complete!');
}

cleanDynamic().catch((err) => {
  console.error('Clean failed:', err);
  process.exit(1);
});
