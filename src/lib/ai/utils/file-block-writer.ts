/**
 * Shared file block write logic.
 *
 * Both file-block-executor.ts and file-block-flush.ts need to write
 * file blocks (write/insert/replace). This module provides the shared
 * implementation to avoid duplication.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { isAllowedPath } from './file-block-constants';
import type { FileBlock } from './file-block-store';

export interface FileBlockResult {
  filePath: string;
  mode: 'write' | 'insert' | 'replace';
  success: boolean;
  message: string;
}

/**
 * Execute a single file block (write/insert/replace).
 * Returns a result describing what happened.
 */
export async function writeFileBlock(block: FileBlock): Promise<FileBlockResult> {
  // Validate path
  if (path.isAbsolute(block.filePath)) {
    return { filePath: block.filePath, mode: block.mode, success: false, message: '请使用相对路径' };
  }

  const fullPath = path.join(process.cwd(), block.filePath);
  const normalized = path.normalize(fullPath);

  if (!isAllowedPath(normalized)) {
    const { ALLOWED_DIRS } = await import('./file-block-constants');
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
