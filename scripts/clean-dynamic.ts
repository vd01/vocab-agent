/**
 * 一键清理 Developer Agent 动态生成的所有内容
 * - DB 表: dynamic_commands + developer_lessons 清空
 * - 文件目录: generated/ 递归删除
 * - 文件目录: src/components/generated/ 递归删除（保留目录本身）
 *
 * 注意: component-registry.ts 现在是运行时动态加载，无需重置
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

async function cleanDynamic() {
  console.log('🧹 Cleaning Developer Agent dynamic content...\n');

  // 1. 清空 DB 表
  console.log('[1/3] Clearing database tables...');
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
  console.log('\n[2/3] Removing generated/ directory...');
  if (fs.existsSync(GENERATED_DIR)) {
    fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
    console.log('  ✓ generated/ removed');
  } else {
    console.log('  (generated/ does not exist, skipped)');
  }

  // 3. 递归删除 src/components/generated/ 内容，保留目录本身
  console.log('\n[3/3] Cleaning src/components/generated/...');
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

  console.log('\n✅ Clean complete!');
}

cleanDynamic().catch((err) => {
  console.error('Clean failed:', err);
  process.exit(1);
});
