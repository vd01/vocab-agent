/**
 * parseFileBlocks — 从 LLM 文本输出中解析标记块
 *
 * 标记块协议：
 *
 * <<<file-write:路径>>>
 * 代码内容...
 * <<<end>>>
 *
 * <<<file-edit:路径:insert:行号>>>
 * 代码内容...
 * <<<end>>>
 *
 * <<<file-edit:路径:replace:起始行-结束行>>>
 * 代码内容...
 * <<<end>>>
 */

import type { FileBlock } from './file-block-store';

// 正则匹配三种标记块格式
// 注意：[\s\S]*? 是非贪婪匹配，确保多个标记块之间不会互相吞噬
// 标记后允许无换行（\n?），使解析更宽容
const FILE_WRITE_RE = /<<<file-write:(.+?)>>>\n?([\s\S]*?)\n?<<<end>>>/g;
const FILE_EDIT_INSERT_RE = /<<<file-edit:(.+?):insert:(\d+)>>>\n?([\s\S]*?)\n?<<<end>>>/g;
const FILE_EDIT_REPLACE_RE = /<<<file-edit:(.+?):replace:(\d+)-(\d+)>>>\n?([\s\S]*?)\n?<<<end>>>/g;

/**
 * 从 LLM 文本输出中解析所有标记块。
 * 返回按出现顺序排列的 FileBlock 数组。
 */
export function parseFileBlocks(text: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  const seen = new Set<string>();

  // Normalize path separators: Windows backslash → forward slash
  const normalizePath = (p: string) => p.replace(/\\/g, '/');

  // 解析 file-write 标记块
  let match: RegExpExecArray | null;
  FILE_WRITE_RE.lastIndex = 0;
  while ((match = FILE_WRITE_RE.exec(text)) !== null) {
    const filePath = normalizePath(match[1].trim());
    blocks.push({
      filePath,
      mode: 'write',
      content: match[2],
    });
    seen.add(filePath);
  }

  // 解析 file-edit insert 标记块
  FILE_EDIT_INSERT_RE.lastIndex = 0;
  while ((match = FILE_EDIT_INSERT_RE.exec(text)) !== null) {
    const filePath = normalizePath(match[1].trim());
    const startLine = parseInt(match[2], 10);
    blocks.push({
      filePath,
      mode: 'insert',
      content: match[3],
      startLine,
    });
    seen.add(filePath);
  }

  // 解析 file-edit replace 标记块
  FILE_EDIT_REPLACE_RE.lastIndex = 0;
  while ((match = FILE_EDIT_REPLACE_RE.exec(text)) !== null) {
    const filePath = normalizePath(match[1].trim());
    const startLine = parseInt(match[2], 10);
    const endLine = parseInt(match[3], 10);
    blocks.push({
      filePath,
      mode: 'replace',
      content: match[4],
      startLine,
      endLine,
    });
    seen.add(filePath);
  }

  return blocks;
}

/**
 * 检查文本中是否包含标记块（用于调试和日志）。
 */
export function hasFileBlocks(text: string): boolean {
  return text.includes('<<<file-write:') || text.includes('<<<file-edit:');
}
