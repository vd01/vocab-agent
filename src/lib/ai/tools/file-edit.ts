import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { fileBlockStore } from '../utils/file-block-store';

// Same whitelist as file-write
const ALLOWED_EDIT_DIRS = [
  path.join(process.cwd(), 'generated'),
  path.join(process.cwd(), 'src', 'components', 'generated'),
  path.join(process.cwd(), 'src', 'app', 'api'),
];

function isAllowedEditPath(normalized: string): boolean {
  return ALLOWED_EDIT_DIRS.some(dir => normalized.startsWith(path.normalize(dir)));
}

export const fileEditTool = tool({
  description: `确认编辑文件。先在回复中用标记块输出代码，再调用本工具确认编辑。

插入模式 — 在第N行后插入代码：
<<<file-edit:路径:insert:10>>>
新代码...
<<<end>>>
然后调用：file-edit({ filePath: "路径", mode: "insert", startLine: 10 })

替换模式 — 替换第M到N行（包含首尾）：
<<<file-edit:路径:replace:15-18>>>
替换代码...
<<<end>>>
然后调用：file-edit({ filePath: "路径", mode: "replace", startLine: 15, endLine: 18 })

代码在标记块中原样输出，不需要 JSON 转义。行号从 1 开始。可编辑目录：generated/、src/components/generated/、src/app/api/`,
  inputSchema: z.object({
    filePath: z.string().describe('文件路径，必须与标记块中的路径一致'),
    mode: z.enum(['insert', 'replace']).describe('insert=在指定行后插入; replace=替换指定行范围'),
    startLine: z.number().describe('insert模式=在第N行后插入; replace模式=起始行号(1-based)'),
    endLine: z.number().optional().describe('replace模式的结束行号(1-based, 包含该行)'),
  }),
  execute: async ({ filePath, mode, startLine, endLine }) => {
    // Reject absolute paths
    if (path.isAbsolute(filePath)) {
      return { type: 'error', message: '请使用相对路径' };
    }

    // Security: only allow editing in whitelisted directories
    const fullPath = path.join(process.cwd(), filePath);
    const normalized = path.normalize(fullPath);
    if (!isAllowedEditPath(normalized)) {
      const allowedList = ALLOWED_EDIT_DIRS
        .map(d => path.relative(process.cwd(), d))
        .join(', ');
      return { type: 'error', message: `安全限制：只能编辑以下目录: ${allowedList}` };
    }

    // Get content from file block store
    const block = fileBlockStore.consume(filePath);
    if (!block) {
      return {
        type: 'retry',
        message: `标记块内容尚未就绪（标记块和 tool 调用不能在同一条消息中）。请重新调用 file-edit({ filePath: "${filePath}", mode: "${mode}", startLine: ${startLine}${endLine ? `, endLine: ${endLine}` : ''} })，标记块内容已在上条消息中输出。`,
      };
    }

    const newContent = block.content;

    try {
      // Read current file
      let content: string;
      try {
        content = await fs.readFile(normalized, 'utf-8');
      } catch {
        return { type: 'error', message: `文件不存在: ${filePath}` };
      }

      const lines = content.split('\n');
      const totalLines = lines.length;

      if (mode === 'insert') {
        // Insert after startLine
        if (startLine < 0 || startLine > totalLines) {
          return { type: 'error', message: `行号超出范围（文件共 ${totalLines} 行，insert 位置应在 0-${totalLines} 之间）` };
        }

        const newLines = newContent.split('\n');
        // Insert after startLine: lines[0..startLine-1] + newLines + lines[startLine..end]
        const before = lines.slice(0, startLine);
        const after = lines.slice(startLine);
        const result = [...before, ...newLines, ...after].join('\n');

        await fs.writeFile(normalized, result, 'utf-8');
        return {
          type: 'success',
          path: filePath,
          line: startLine + 1,
          message: `已在 ${filePath} 第 ${startLine} 行后插入 ${newLines.length} 行代码`,
        };
      }

      if (mode === 'replace') {
        if (endLine === undefined) {
          return { type: 'error', message: 'replace 模式必须提供 endLine 参数' };
        }
        if (startLine < 1 || endLine > totalLines || startLine > endLine) {
          return { type: 'error', message: `行号范围无效（文件共 ${totalLines} 行，范围应为 1-${totalLines}，startLine <= endLine）` };
        }

        const newLines = newContent.split('\n');
        // Replace lines[startLine-1..endLine-1] with newLines
        const before = lines.slice(0, startLine - 1);
        const after = lines.slice(endLine);
        const result = [...before, ...newLines, ...after].join('\n');

        await fs.writeFile(normalized, result, 'utf-8');
        const replacedCount = endLine - startLine + 1;
        return {
          type: 'success',
          path: filePath,
          line: startLine,
          message: `已替换 ${filePath} 第 ${startLine}-${endLine} 行（${replacedCount} 行 → ${newLines.length} 行）`,
        };
      }

      return { type: 'error', message: `未知模式: ${mode}` };
    } catch (error) {
      return { type: 'error', message: `编辑失败: ${String(error)}` };
    }
  },
});
