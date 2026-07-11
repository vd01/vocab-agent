import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';

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
  description: `编辑项目文件的局部内容（类似 sed 替换）。支持编辑以下目录：
- generated/
- src/components/generated/
- src/app/api/

工作方式：在文件中查找 oldString 的第一次出现，替换为 newString。oldString 必须精确匹配（包括缩进和空行）。

如果文件较大且 oldString 可能不唯一，可以提供 lineRange 参数缩小搜索范围。`,
  inputSchema: z.object({
    filePath: z.string().describe('相对路径，如 "generated/components/word-match.tsx" 或 "src/components/generated/demo.tsx"'),
    oldString: z.string().describe('要替换的原始文本（必须精确匹配，包括缩进、空行）'),
    newString: z.string().describe('替换后的新文本'),
    lineRange: z.string().optional().describe('行范围，如 "10-25"，缩小搜索范围。oldString 只在该范围内查找。'),
  }),
  execute: async ({ filePath, oldString, newString, lineRange }) => {
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

    try {
      // Read current file
      let content: string;
      try {
        content = await fs.readFile(normalized, 'utf-8');
      } catch {
        return { type: 'error', message: `文件不存在: ${filePath}` };
      }

      // If lineRange provided, narrow the search scope
      let searchContent = content;
      let lineOffset = 0;
      let prefix = '';
      let suffix = '';

      if (lineRange) {
        const match = lineRange.match(/^(\d+)(?:-(\d+))?$/);
        if (!match) {
          return { type: 'error', message: `lineRange 格式错误，应为 "10" 或 "10-25"` };
        }
        const startLine = parseInt(match[1]);
        const endLine = match[2] ? parseInt(match[2]) : startLine;

        const lines = content.split('\n');
        if (startLine < 1 || startLine > lines.length) {
          return { type: 'error', message: `行号超出范围（文件共 ${lines.length} 行）` };
        }

        const startIdx = startLine - 1;
        const endIdx = Math.min(endLine, lines.length);
        prefix = lines.slice(0, startIdx).join('\n') + (startIdx > 0 ? '\n' : '');
        searchContent = lines.slice(startIdx, endIdx).join('\n');
        suffix = (endIdx < lines.length ? '\n' : '') + lines.slice(endIdx).join('\n');
        lineOffset = startLine - 1;
      }

      // Find and replace within search scope
      const index = searchContent.indexOf(oldString);
      if (index === -1) {
        // Provide helpful context about what's in the file
        const lines = searchContent.split('\n');
        const previewLines = Math.min(20, lines.length);
        const preview = lines.slice(0, previewLines).map((l, i) => `${lineOffset + i + 1}: ${l}`).join('\n');
        return {
          type: 'error',
          message: `未找到匹配的文本。请检查 oldString 是否精确匹配（包括缩进、空行）。\n\n${lineRange ? `搜索范围: 第 ${lineOffset + 1}-${lineOffset + lines.length} 行\n\n` : ''}文件预览:\n${preview}`,
        };
      }

      // Check for multiple occurrences within search scope
      const secondIndex = searchContent.indexOf(oldString, index + 1);
      if (secondIndex !== -1) {
        return {
          type: 'error',
          message: `在搜索范围内找到多处匹配，oldString 必须唯一。请扩大上下文使其唯一匹配，或使用 lineRange 缩小范围。`,
        };
      }

      // Apply replacement
      const newSearchContent = searchContent.slice(0, index) + newString + searchContent.slice(index + oldString.length);
      const newContent = prefix + newSearchContent + suffix;
      await fs.writeFile(normalized, newContent, 'utf-8');

      // Show context around the change
      const lineNum = (prefix.slice(0, index + prefix.length).split('\n').length) + lineOffset;
      return {
        type: 'success',
        path: filePath,
        line: lineNum,
        message: `已替换 ${filePath} 第 ${lineNum} 行附近的内容`,
      };
    } catch (error) {
      return { type: 'error', message: `编辑失败: ${String(error)}` };
    }
  },
});
