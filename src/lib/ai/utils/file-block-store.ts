/**
 * FileBlockStore — 标记块内容暂存
 *
 * LLM 在文本输出中用 <<<file-write:...>>>...<<<end>>> 标记块输出代码，
 * 解析后存入此 store，tool execute 从 store 取出内容执行写入。
 *
 * 生命周期：每次 API 请求开始时清空，请求结束后丢弃。
 *
 * 支持两种写入方式：
 * 1. 实时追加：appendText() 在流式输出中实时调用，检测完整标记块后自动解析
 * 2. 批量解析：parseAndStore() 在 onStepFinish 中调用，作为兜底
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
  private textBuffer: string = '';

  /**
   * 存入标记块内容。同一 filePath 会被覆盖（后写入的优先）。
   */
  set(filePath: string, block: FileBlock): void {
    this.pending.set(filePath, block);
  }

  /**
   * 获取标记块内容（不删除）。
   */
  get(filePath: string): FileBlock | undefined {
    return this.pending.get(filePath);
  }

  /**
   * 取出标记块内容并删除（消费模式，每个标记块只能用一次）。
   */
  consume(filePath: string): FileBlock | undefined {
    const block = this.pending.get(filePath);
    if (block) {
      this.pending.delete(filePath);
    }
    return block;
  }

  /**
   * 追加流式文本，自动检测并解析完整的标记块。
   * 在 SSE 流处理中每次收到 text-delta 时调用。
   */
  appendText(delta: string): void {
    this.textBuffer += delta;

    // Only try parsing when we see a closing tag
    if (this.textBuffer.includes('<<<end>>>')) {
      const blocks = parseFileBlocks(this.textBuffer);
      for (const block of blocks) {
        this.pending.set(block.filePath, block);
      }

      // Reset buffer: keep text after the last <<<end>>>
      const lastEndIdx = this.textBuffer.lastIndexOf('<<<end>>>');
      if (lastEndIdx !== -1) {
        this.textBuffer = this.textBuffer.slice(lastEndIdx + '<<<end>>>'.length);
      }
    }
  }

  /**
   * 批量解析文本中的所有标记块并存入 store。
   * 在 onStepFinish 中调用，作为实时解析的兜底。
   */
  parseAndStore(text: string): number {
    const blocks = parseFileBlocks(text);
    for (const block of blocks) {
      this.pending.set(block.filePath, block);
    }
    return blocks.length;
  }

  /**
   * 清空所有暂存内容和文本缓冲区。每次新 API 请求开始时调用。
   */
  clear(): void {
    this.pending.clear();
    this.textBuffer = '';
  }

  /**
   * 当前暂存的标记块数量。
   */
  get size(): number {
    return this.pending.size;
  }
}

export const fileBlockStore = new FileBlockStore();
