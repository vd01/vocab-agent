/**
 * FileBlockExecutor — 执行标记块文件操作
 *
 * 从 fileBlockStore 中取出标记块，执行文件写入/编辑操作。
 * 供 route.ts 的 prepareStep 调用。
 */

import { fileBlockStore } from './file-block-store';
import { writeFileBlock, type FileBlockResult } from './file-block-writer';

/**
 * Execute all pending file blocks from the store.
 * Returns results for each operation.
 */
export async function executeFileBlocks(): Promise<FileBlockResult[]> {
  const blocks = fileBlockStore.consumeAll();
  if (blocks.length === 0) return [];

  const results: FileBlockResult[] = [];

  for (const block of blocks) {
    const result = await writeFileBlock(block);
    results.push(result);
  }

  return results;
}

/**
 * Parse file blocks from messages and store them, then execute all pending blocks.
 */
export async function parseAndExecuteFileBlocks(messages: { role: string; content: string | any[] }[]): Promise<FileBlockResult[]> {
  // Parse file blocks from all assistant messages
  let newBlockCount = 0;
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        newBlockCount += fileBlockStore.parseAndStore(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as any[]) {
          if (part.type === 'text' && typeof part.text === 'string') {
            newBlockCount += fileBlockStore.parseAndStore(part.text);
          }
        }
      }
    }
  }

  if (newBlockCount > 0) {
    console.log(`[FileBlockExecutor] Parsed ${newBlockCount} new file block(s)`);
  }

  return executeFileBlocks();
}
