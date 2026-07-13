/**
 * FileBlockStore — 标记块内容暂存
 *
 * LLM 在文本输出中用 <<<file-write:...>>>...<<<end>>> 标记块输出代码，
 * prepareStep 解析标记块后存入此 store，executor 从 store 取出内容执行写入。
 *
 * 生命周期：每次 API 请求开始时清空，请求结束后丢弃。
 */

import { parseFileBlocks } from './parse-file-blocks';

export interface FileBlock {
  filePath: string;
  mode: 'write' | 'insert' | 'replace';
  content: string;
  startLine?: number;
  endLine?: number;
}

class FileBlockStore {
  private pending: Map<string, FileBlock> = new Map();

  /**
   * 当前 step 的文本缓冲区。
   * LLM 流式输出文本时实时追加，工具 execute 时可从中解析标记块。
   * 每次 onStepFinish 后清空。
   */
  private stepTextBuffer: string = '';

  /**
   * 存入标记块内容。同一 filePath 会被覆盖（后写入的优先）。
   */
  set(filePath: string, block: FileBlock): void {
    this.pending.set(filePath, block);
  }

  /**
   * 取出并删除所有未处理的标记块。
   */
  consumeAll(): FileBlock[] {
    const blocks = Array.from(this.pending.values());
    this.pending.clear();
    return blocks;
  }

  /**
   * 批量解析文本中的所有标记块并存入 store。
   * 返回新解析的标记块数量。
   */
  parseAndStore(text: string): number {
    const blocks = parseFileBlocks(text);
    for (const block of blocks) {
      this.pending.set(block.filePath, block);
    }
    return blocks.length;
  }

  /**
   * 追加文本到当前 step 缓冲区。
   * 在 streamText 的文本流中调用，确保工具 execute 时
   * 能从缓冲区中解析到标记块。
   */
  appendStepText(text: string): void {
    this.stepTextBuffer += text;
  }

  /**
   * 从当前 step 缓冲区中解析指定路径的标记块，
   * 执行写入操作，并从缓冲区中移除已处理的内容。
   * 返回成功写入的标记块列表。
   */
  flushFromStepText(requestedPaths: string[]): FileBlock[] {
    if (!this.stepTextBuffer || requestedPaths.length === 0) return [];

    const allBlocks = parseFileBlocks(this.stepTextBuffer);
    if (allBlocks.length === 0) return [];

    const normalizedRequests = new Set(
      requestedPaths.map(p => p.replace(/\\/g, '/'))
    );

    const matched: FileBlock[] = [];
    const unmatched: FileBlock[] = [];

    for (const block of allBlocks) {
      const normalized = block.filePath.replace(/\\/g, '/');
      if (normalizedRequests.has(normalized)) {
        matched.push(block);
        // Also store in pending so prepareStep won't re-execute
        this.pending.set(block.filePath, block);
      } else {
        unmatched.push(block);
      }
    }

    return matched;
  }

  /**
   * 清空 step 文本缓冲区。在 onStepFinish 后调用。
   */
  clearStepText(): void {
    this.stepTextBuffer = '';
  }

  /**
   * 当前暂存的标记块数量。
   */
  get size(): number {
    return this.pending.size;
  }

  /**
   * 清空所有暂存内容。每次新 API 请求开始时调用。
   */
  clear(): void {
    this.pending.clear();
    this.stepTextBuffer = '';
  }
}

export const fileBlockStore = new FileBlockStore();
