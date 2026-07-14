/**
 * file-block-flush — 在工具执行前 flush 待写入的标记块
 *
 * 标记块（<<<file-write:...>>>）的解析和写入延迟到 prepareStep 执行，
 * 但工具调用（如 create-command）在同一 step 内立即执行。
 * 这导致工具读取文件时，标记块还没落盘，文件不存在。
 *
 * 本模块提供 flushFileBlocks()，在工具读取文件前：
 * 1. 从 fileBlockStore 的 pending store 中查找匹配路径的标记块
 * 2. 从 fileBlockStore 的 step 文本缓冲区中解析匹配路径的标记块
 * 3. 立即执行写入操作，确保文件已落盘
 * 4. 已写入的标记块从 store 中移除，prepareStep 不会重复执行
 */

import { fileBlockStore, type FileBlock } from '../utils/file-block-store';
import { writeFileBlock } from '../utils/file-block-writer';

/**
 * Flush pending file blocks for the given paths.
 *
 * Strategy:
 * 1. Check pending store for matching blocks (without consuming unmatched ones)
 * 2. Parse the step text buffer for matching blocks
 * 3. Write matching blocks to disk immediately
 * 4. Remove written blocks from pending store to avoid double-execution
 */
export async function flushFileBlocks(requestedPaths: string[]): Promise<void> {
  if (requestedPaths.length === 0) return;

  const normalizedRequests = new Set(
    requestedPaths.map(p => p.replace(/\\/g, '/'))
  );

  // 1. Check pending store — collect matching blocks without consuming all
  const matchedFromStore: FileBlock[] = [];
  const allPending = fileBlockStore.peekAll();

  for (const block of allPending) {
    if (normalizedRequests.has(block.filePath.replace(/\\/g, '/'))) {
      matchedFromStore.push(block);
    }
  }

  // Remove matched blocks from store (they will be written now)
  for (const block of matchedFromStore) {
    fileBlockStore.remove(block.filePath);
  }

  // Write matched blocks from store
  for (const block of matchedFromStore) {
    const result = await writeFileBlock(block);
    if (result.success) {
      console.log(`[flushFileBlocks] Wrote ${block.filePath} (${block.content.length} chars)`);
    } else {
      console.error(`[flushFileBlocks] Failed to write ${block.filePath}: ${result.message}`);
    }
  }

  // 2. Parse step text buffer for any blocks not yet in store
  const fromStepText = fileBlockStore.flushFromStepText(requestedPaths);
  for (const block of fromStepText) {
    const result = await writeFileBlock(block);
    if (result.success) {
      console.log(`[flushFileBlocks] Wrote ${block.filePath} from step text (${block.content.length} chars)`);
    } else {
      console.error(`[flushFileBlocks] Failed to write ${block.filePath}: ${result.message}`);
    }
  }
}
