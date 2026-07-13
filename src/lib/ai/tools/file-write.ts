import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';

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
