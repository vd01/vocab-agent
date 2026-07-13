/**
 * FileBlockExecutor — 执行标记块文件操作
 *
 * 从 fileBlockStore 中取出标记块，执行文件写入/编辑操作。
 * 供 route.ts 的 prepareStep 调用。
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileBlockStore, type FileBlock } from './file-block-store';

// Whitelist of directories where file operations are allowed
const ALLOWED_DIRS = [
  path.join(process.cwd(), 'generated'),
  path.join(process.cwd(), 'src', 'components', 'generated'),
  path.join(process.cwd(), 'src', 'app', 'api'),
];

function isAllowedPath(normalized: string): boolean {
  return ALLOWED_DIRS.some(dir => normalized.startsWith(path.normalize(dir)));
}

export interface FileBlockResult {
  filePath: string;
  mode: 'write' | 'insert' | 'replace';
  success: boolean;
  message: string;
}

/**
 * Execute all pending file blocks from the store.
 * Returns results for each operation.
 */
export async function executeFileBlocks(): Promise<FileBlockResult[]> {
  const blocks = fileBlockStore.consumeAll();
  if (blocks.length === 0) return [];

  const results: FileBlockResult[] = [];

  for (const block of blocks) {
    const result = await executeBlock(block);
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

async function executeBlock(block: FileBlock): Promise<FileBlockResult> {
  // Validate path
  if (path.isAbsolute(block.filePath)) {
    return { filePath: block.filePath, mode: block.mode, success: false, message: '请使用相对路径' };
  }

  const fullPath = path.join(process.cwd(), block.filePath);
  const normalized = path.normalize(fullPath);

  if (!isAllowedPath(normalized)) {
    const allowedList = ALLOWED_DIRS.map(d => path.relative(process.cwd(), d)).join(', ');
    return { filePath: block.filePath, mode: block.mode, success: false, message: `安全限制：只能操作以下目录: ${allowedList}` };
  }

  try {
    if (block.mode === 'write') {
      return await executeWrite(block, normalized);
    } else if (block.mode === 'insert') {
      return await executeInsert(block, normalized);
    } else if (block.mode === 'replace') {
      return await executeReplace(block, normalized);
    }
    return { filePath: block.filePath, mode: block.mode, success: false, message: `未知模式: ${block.mode}` };
  } catch (error) {
    return { filePath: block.filePath, mode: block.mode, success: false, message: `操作失败: ${String(error)}` };
  }
}

async function executeWrite(block: FileBlock, normalized: string): Promise<FileBlockResult> {
  await fs.mkdir(path.dirname(normalized), { recursive: true });
  await fs.writeFile(normalized, block.content, 'utf-8');
  const lines = block.content.split('\n').length;
  return {
    filePath: block.filePath,
    mode: 'write',
    success: true,
    message: `已写入 ${block.filePath} (${block.content.length} 字符, ${lines} 行)`,
  };
}

async function executeInsert(block: FileBlock, normalized: string): Promise<FileBlockResult> {
  const startLine = block.startLine ?? 0;

  let content: string;
  try {
    content = await fs.readFile(normalized, 'utf-8');
  } catch {
    return { filePath: block.filePath, mode: 'insert', success: false, message: `文件不存在: ${block.filePath}` };
  }

  const lines = content.split('\n');
  if (startLine < 0 || startLine > lines.length) {
    return { filePath: block.filePath, mode: 'insert', success: false, message: `行号超出范围（文件共 ${lines.length} 行，insert 位置应在 0-${lines.length} 之间）` };
  }

  const newLines = block.content.split('\n');
  const result = [...lines.slice(0, startLine), ...newLines, ...lines.slice(startLine)].join('\n');
  await fs.writeFile(normalized, result, 'utf-8');

  return {
    filePath: block.filePath,
    mode: 'insert',
    success: true,
    message: `已在 ${block.filePath} 第 ${startLine} 行后插入 ${newLines.length} 行`,
  };
}

async function executeReplace(block: FileBlock, normalized: string): Promise<FileBlockResult> {
  const startLine = block.startLine ?? 1;
  const endLine = block.endLine ?? startLine;

  let content: string;
  try {
    content = await fs.readFile(normalized, 'utf-8');
  } catch {
    return { filePath: block.filePath, mode: 'replace', success: false, message: `文件不存在: ${block.filePath}` };
  }

  const lines = content.split('\n');
  if (startLine < 1 || endLine > lines.length || startLine > endLine) {
    return { filePath: block.filePath, mode: 'replace', success: false, message: `行号范围无效（文件共 ${lines.length} 行）` };
  }

  const newLines = block.content.split('\n');
  const replacedCount = endLine - startLine + 1;
  const result = [...lines.slice(0, startLine - 1), ...newLines, ...lines.slice(endLine)].join('\n');
  await fs.writeFile(normalized, result, 'utf-8');

  return {
    filePath: block.filePath,
    mode: 'replace',
    success: true,
    message: `已替换 ${block.filePath} 第 ${startLine}-${endLine} 行（${replacedCount} 行 → ${newLines.length} 行）`,
  };
}
