import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';

interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number; // bytes, for files only
}

export const fileListTool = tool({
  description: `列出目录内容，浏览项目文件结构。使用相对路径。

常用路径:
- "src/components" — 查看组件目录
- "src/lib" — 查看库代码
- "generated" — 查看生成的代码
- "src/app/api" — 查看 API 路由`,
  inputSchema: z.object({
    path: z.string().describe('相对路径，如 "src/components"、"generated"、"src/lib/ai/tools"'),
    recursive: z.boolean().optional().describe('是否递归列出子目录（默认 false）。递归深度最多 3 层，最多 200 个条目。'),
  }),
  execute: async ({ path: dirPath, recursive = false }) => {
    // Reject absolute paths
    if (path.isAbsolute(dirPath)) {
      return { type: 'error', message: '请使用相对路径，不要使用绝对路径' };
    }

    // Security: only allow reading within project
    const fullPath = path.join(process.cwd(), dirPath);
    const normalized = path.normalize(fullPath);
    if (!normalized.startsWith(path.normalize(process.cwd()))) {
      return { type: 'error', message: '安全限制：不能访问项目外的目录' };
    }

    try {
      const stat = await fs.stat(normalized);
      if (!stat.isDirectory()) {
        return { type: 'error', message: `${dirPath} 不是目录` };
      }

      if (recursive) {
        const entries = await listRecursive(normalized, process.cwd(), 3, 200);
        return { type: 'success', path: dirPath, entries };
      } else {
        const entries = await listDir(normalized);
        return { type: 'success', path: dirPath, entries };
      }
    } catch {
      return { type: 'error', message: `目录不存在: ${dirPath}` };
    }
  },
});

async function listDir(dirPath: string): Promise<FileEntry[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const result: FileEntry[] = [];

  for (const entry of entries) {
    // Skip node_modules and hidden dirs
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      result.push({ name: entry.name, type: 'dir' });
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(path.join(dirPath, entry.name));
        result.push({ name: entry.name, type: 'file', size: stat.size });
      } catch {
        result.push({ name: entry.name, type: 'file' });
      }
    }
  }

  // Sort: dirs first, then files, alphabetically
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

interface RecursiveEntry extends FileEntry {
  children?: RecursiveEntry[];
  relativePath: string;
}

async function listRecursive(
  dirPath: string,
  projectRoot: string,
  maxDepth: number,
  maxEntries: number,
): Promise<RecursiveEntry[]> {
  if (maxDepth <= 0) return [];

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const result: RecursiveEntry[] = [];
  let count = 0;

  for (const entry of entries) {
    if (count >= maxEntries) break;
    // Skip node_modules and hidden dirs
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      count++;
      const item: RecursiveEntry = { name: entry.name, type: 'dir', relativePath };
      try {
        item.children = await listRecursive(fullPath, projectRoot, maxDepth - 1, maxEntries - count);
        count += item.children.length;
      } catch {
        item.children = [];
      }
      result.push(item);
    } else if (entry.isFile()) {
      count++;
      try {
        const stat = await fs.stat(fullPath);
        result.push({ name: entry.name, type: 'file', size: stat.size, relativePath });
      } catch {
        result.push({ name: entry.name, type: 'file', relativePath });
      }
    }
  }

  // Sort: dirs first, then files
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}
