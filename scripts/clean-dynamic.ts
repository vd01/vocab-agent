/**
 * 一键清理 Developer Agent 动态生成的所有内容
 * - DB 表: dynamic_commands + developer_lessons 清空
 * - 文件目录: generated/ 递归删除
 * - 文件目录: src/components/generated/ 递归删除（保留目录本身）
 * - 注册表: component-registry.ts 重置为空模板
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
const REGISTRY_PATH = path.join(process.cwd(), 'src', 'components', 'generative', 'component-registry.ts');

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

  // 4. 重置 component-registry.ts 为空模板
  console.log('\n[4/4] Resetting component-registry.ts...');
  // 删除当前文件，让 ensure-registry 重新创建空模板
  if (fs.existsSync(REGISTRY_PATH)) {
    fs.rmSync(REGISTRY_PATH);
    console.log('  ✓ Removed current registry');
  }
  // 内联创建空模板
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, EMPTY_REGISTRY, 'utf-8');
  console.log('  ✓ Registry reset to empty template');

  console.log('\n✅ Clean complete!');
}

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

cleanDynamic().catch((err) => {
  console.error('Clean failed:', err);
  process.exit(1);
});
