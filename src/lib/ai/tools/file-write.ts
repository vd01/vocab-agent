import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';

// Whitelist of directories where file-write is allowed to create files.
// This balances safety (no writing to core AI code) with flexibility
// (Developer needs to write components, API routes, and generated code).
const ALLOWED_WRITE_DIRS = [
  path.join(process.cwd(), 'generated'),
  path.join(process.cwd(), 'src', 'components', 'generated'),
  path.join(process.cwd(), 'src', 'app', 'api'),
];

function isAllowedWritePath(normalized: string): boolean {
  return ALLOWED_WRITE_DIRS.some(dir => normalized.startsWith(path.normalize(dir)));
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export const fileWriteTool = tool({
  description: `将代码写入项目文件。支持写入以下目录：
- generated/ — 生成的代码、工具脚本、临时文件
- src/components/generated/ — 动态注册的 UI 组件
- src/app/api/ — API 路由

**重要：这是写入代码的唯一方式。** 写入后，其他工具（如 create-command、register-component）可以通过文件路径引用已写入的代码，避免在 JSON 参数中嵌入长代码。

对于长代码（超过几行），推荐先写入文件再引用，而不是直接在参数中传递。`,
  inputSchema: z.object({
    filePath: z.string().describe('相对路径。如 "generated/tools/word-match.js"、"src/components/generated/word-match-panel.tsx"、"generated/components/demo.tsx"'),
    content: z.string().describe('文件内容。直接传入代码文本，无需 base64 编码。'),
  }),
  execute: async ({ filePath, content }) => {
    // Reject absolute paths
    if (path.isAbsolute(filePath)) {
      return { type: 'error', message: `请使用相对路径，不要使用绝对路径。例如 "generated/tools/demo.js" 而不是 "${filePath}"` };
    }

    // Security: only allow writing to whitelisted directories
    const fullPath = path.join(process.cwd(), filePath);
    const normalized = path.normalize(fullPath);
    if (!isAllowedWritePath(normalized)) {
      const allowedList = ALLOWED_WRITE_DIRS
        .map(d => path.relative(process.cwd(), d))
        .join(', ');
      return { type: 'error', message: `安全限制：只能写入以下目录: ${allowedList}` };
    }

    try {
      await ensureDir(path.dirname(normalized));
      await fs.writeFile(normalized, content, 'utf-8');
      return { type: 'success', path: filePath, message: `文件已写入: ${filePath} (${content.length} 字符)` };
    } catch (error) {
      return { type: 'error', message: `写入失败: ${String(error)}` };
    }
  },
});

export const fileReadTool = tool({
  description: '读取项目中的文件内容。filePath 必须是相对路径（如 "generated/components/demo.tsx"），不要使用绝对路径。',
  inputSchema: z.object({
    filePath: z.string().describe('文件路径，相对于项目根目录。例如 "generated/components/demo.tsx"、"src/lib/db/schema.ts"。不要以盘符或 / 开头。'),
  }),
  execute: async ({ filePath }) => {
    // Reject absolute paths
    if (path.isAbsolute(filePath)) {
      return { type: 'error', message: `请使用相对路径，不要使用绝对路径。例如 "generated/components/demo.tsx" 而不是 "${filePath}"` };
    }

    // Only allow reading within project
    const fullPath = path.join(process.cwd(), filePath);
    const normalized = path.normalize(fullPath);
    if (!normalized.startsWith(path.normalize(process.cwd()))) {
      return { type: 'error', message: '安全限制：不能读取项目外的文件' };
    }

    try {
      const stat = await fs.stat(normalized);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(normalized);
        return { type: 'success', content: `[目录] 包含文件: ${entries.join(', ')}` };
      }
      const content = await fs.readFile(normalized, 'utf-8');
      // Truncate large files
      const truncated = content.length > 50000 ? content.slice(0, 50000) + '\n... (truncated)' : content;
      return { type: 'success', content: truncated };
    } catch (error) {
      return { type: 'error', message: `读取失败: ${String(error)}` };
    }
  },
});
