/**
 * file-block-flush — 在工具执行前 flush 待写入的标记块
 *
 * 标记块（<<<file-write:...>>>）的解析和写入延迟到 prepareStep 执行，
 * 但工具调用（如 create-command）在同一 step 内立即执行。
 * 这导致工具读取文件时，标记块还没落盘，文件不存在。
 *
 * 本模块提供 flushFileBlocks()，在工具读取文件前先执行
 * fileBlockStore 中匹配路径的待写入标记块，确保文件已落盘。
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

/**
 * Flush pending file blocks that match the given paths.
 * Only writes blocks whose filePath is in the requestedPaths list.
 * After writing, removes them from the store so prepareStep won't re-execute.
 */
export async function flushFileBlocks(requestedPaths: string[]): Promise<void> {
  if (requestedPaths.length === 0) return;

  // Normalize requested paths for comparison
  const normalizedRequests = new Set(
    requestedPaths.map(p => path.normalize(p))
  );

  // Peek at all pending blocks (don't consume yet — we only want matching ones)
  const allBlocks = fileBlockStore.consumeAll();
  const matching: FileBlock[] = [];
  const remaining: FileBlock[] = [];

  for (const block of allBlocks) {
    const normalized = path.normalize(block.filePath);
    if (normalizedRequests.has(normalized)) {
      matching.push(block);
    } else {
      remaining.push(block);
    }
  }

  // Put non-matching blocks back
  for (const block of remaining) {
    fileBlockStore.set(block.filePath, block);
  }

  // Execute matching blocks
  for (const block of matching) {
    if (path.isAbsolute(block.filePath)) continue;

    const fullPath = path.join(process.cwd(), block.filePath);
    const normalized = path.normalize(fullPath);

    if (!isAllowedPath(normalized)) continue;

    try {
      if (block.mode === 'write') {
        await fs.mkdir(path.dirname(normalized), { recursive: true });
        await fs.writeFile(normalized, block.content, 'utf-8');
        console.log(`[flushFileBlocks] Wrote ${block.filePath} (${block.content.length} chars)`);
      } else if (block.mode === 'insert') {
        const content = await fs.readFile(normalized, 'utf-8');
        const lines = content.split('\n');
        const startLine = block.startLine ?? 0;
        const newLines = block.content.split('\n');
        const result = [...lines.slice(0, startLine), ...newLines, ...lines.slice(startLine)].join('\n');
        await fs.writeFile(normalized, result, 'utf-8');
        console.log(`[flushFileBlocks] Inserted into ${block.filePath} at line ${startLine}`);
      } else if (block.mode === 'replace') {
        const content = await fs.readFile(normalized, 'utf-8');
        const lines = content.split('\n');
        const startLine = block.startLine ?? 1;
        const endLine = block.endLine ?? startLine;
        const newLines = block.content.split('\n');
        const result = [...lines.slice(0, startLine - 1), ...newLines, ...lines.slice(endLine)].join('\n');
        await fs.writeFile(normalized, result, 'utf-8');
        console.log(`[flushFileBlocks] Replaced ${block.filePath} lines ${startLine}-${endLine}`);
      }
    } catch (err) {
      console.error(`[flushFileBlocks] Failed to write ${block.filePath}:`, err);
      // Put the block back so prepareStep can retry
      fileBlockStore.set(block.filePath, block);
    }
  }
}
