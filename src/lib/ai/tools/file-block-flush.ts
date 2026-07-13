/**
 * file-block-flush — 在工具执行前 flush 待写入的标记块
 *
 * 标记块（<<<file-write:...>>>）的解析和写入延迟到 prepareStep 执行，
 * 但工具调用（如 create-command）在同一 step 内立即执行。
 * 这导致工具读取文件时，标记块还没落盘，文件不存在。
 *
 * 本模块提供 flushFileBlocks()，在工具读取文件前：
 * 1. 从 fileBlockStore 的 step 文本缓冲区中解析匹配路径的标记块
 * 2. 立即执行写入操作，确保文件已落盘
 * 3. 已写入的标记块存入 store，prepareStep 不会重复执行
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileBlockStore, type FileBlock } from '../utils/file-block-store';

// Whitelist of directories where file operations are allowed (same as file-block-executor)
const ALLOWED_DIRS = [
  path.join(process.cwd(), 'generated'),
  path.join(process.cwd(), 'src', 'components', 'generated'),
  path.join(process.cwd(), 'src', 'app', 'api'),
];

function isAllowedPath(normalized: string): boolean {
  return ALLOWED_DIRS.some(dir => normalized.startsWith(path.normalize(dir)));
}

async function writeBlock(block: FileBlock): Promise<boolean> {
  if (path.isAbsolute(block.filePath)) return false;

  const fullPath = path.join(process.cwd(), block.filePath);
  const normalized = path.normalize(fullPath);

  if (!isAllowedPath(normalized)) return false;

  try {
    if (block.mode === 'write') {
      await fs.mkdir(path.dirname(normalized), { recursive: true });
      await fs.writeFile(normalized, block.content, 'utf-8');
      console.log(`[flushFileBlocks] Wrote ${block.filePath} (${block.content.length} chars)`);
      return true;
    } else if (block.mode === 'insert') {
      const content = await fs.readFile(normalized, 'utf-8');
      const lines = content.split('\n');
      const startLine = block.startLine ?? 0;
      const newLines = block.content.split('\n');
      const result = [...lines.slice(0, startLine), ...newLines, ...lines.slice(startLine)].join('\n');
      await fs.writeFile(normalized, result, 'utf-8');
      console.log(`[flushFileBlocks] Inserted into ${block.filePath} at line ${startLine}`);
      return true;
    } else if (block.mode === 'replace') {
      const content = await fs.readFile(normalized, 'utf-8');
      const lines = content.split('\n');
      const startLine = block.startLine ?? 1;
      const endLine = block.endLine ?? startLine;
      const newLines = block.content.split('\n');
      const result = [...lines.slice(0, startLine - 1), ...newLines, ...lines.slice(endLine)].join('\n');
      await fs.writeFile(normalized, result, 'utf-8');
      console.log(`[flushFileBlocks] Replaced ${block.filePath} lines ${startLine}-${endLine}`);
      return true;
    }
  } catch (err) {
    console.error(`[flushFileBlocks] Failed to write ${block.filePath}:`, err);
  }
  return false;
}

/**
 * Flush pending file blocks for the given paths.
 *
 * 1. First checks fileBlockStore.pending (from previous prepareStep)
 * 2. Then parses the step text buffer for matching blocks
 * 3. Writes matching blocks to disk immediately
 */
export async function flushFileBlocks(requestedPaths: string[]): Promise<void> {
  if (requestedPaths.length === 0) return;

  const normalizedRequests = new Set(
    requestedPaths.map(p => path.normalize(p))
  );

  // 1. Check pending store first (blocks from previous prepareStep)
  const allPending = fileBlockStore.consumeAll();
  const matchedFromStore: FileBlock[] = [];
  const unmatchedFromStore: FileBlock[] = [];

  for (const block of allPending) {
    if (normalizedRequests.has(path.normalize(block.filePath))) {
      matchedFromStore.push(block);
    } else {
      unmatchedFromStore.push(block);
    }
  }

  // Put unmatched blocks back
  for (const block of unmatchedFromStore) {
    fileBlockStore.set(block.filePath, block);
  }

  // Write matched blocks from store
  for (const block of matchedFromStore) {
    await writeBlock(block);
  }

  // 2. Parse step text buffer for any blocks not yet in store
  const fromStepText = fileBlockStore.flushFromStepText(requestedPaths);
  for (const block of fromStepText) {
    await writeBlock(block);
  }
}
