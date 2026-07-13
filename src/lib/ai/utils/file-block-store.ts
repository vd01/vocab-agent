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
  }
}

export const fileBlockStore = new FileBlockStore();
