import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { fileBlockStore } from '../utils/file-block-store';

// Whitelist of directories where file-write is allowed to create files.
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
  description: `确认写入文件。先在回复中用标记块输出代码，再调用本工具确认写入。

标记块格式：
<<<file-write:路径>>>
代码内容...
<<<end>>>

然后调用：file-write({ filePath: "路径" })

代码在标记块中原样输出，不需要 JSON 转义。支持写入目录：generated/、src/components/generated/、src/app/api/`,
  inputSchema: z.object({
    filePath: z.string().describe('文件路径，必须与标记块中的路径一致。如 "generated/tools/demo.js"、"src/components/generated/demo.tsx"'),
  }),
  execute: async ({ filePath }) => {
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

    // Get content from file block store
    const block = fileBlockStore.consume(filePath);
    if (!block) {
      return {
        type: 'retry',
        message: `标记块内容尚未就绪（标记块和 tool 调用不能在同一条消息中）。请重新调用 file-write({ filePath: "${filePath}" })，标记块内容已在上条消息中输出。`,
      };
    }

    const content = block.content;

    try {
      await ensureDir(path.dirname(normalized));
      await fs.writeFile(normalized, content, 'utf-8');
      return { type: 'success', path: filePath, message: `文件已写入: ${filePath} (${content.length} 字符, ${content.split('\n').length} 行)` };
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
