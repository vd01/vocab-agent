import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { dynamicCommands } from '@/lib/db/schema';
import { v4 as uuid } from 'uuid';
import { eq } from 'drizzle-orm';

export const registerToolTool = tool({
  description: `注册新的 / 命令到系统。将工具代码保存到数据库并使其可用。

**推荐使用 create-command 代替本工具**，它一步完成命令注册和组件注册。

如果单独使用本工具，提供 toolCode 的方式有两种（二选一）：
1. toolCode: 直接传入简短的函数代码字符串（适合几行以内的简单代码）
2. toolCodePath: 传入代码文件路径（推荐！适合复杂代码，避免 JSON 转义问题）`,
  inputSchema: z.object({
    name: z.string().describe('命令名称（不含 / 前缀），如 "word-game"'),
    description: z.string().describe('命令描述'),
    toolCode: z.string().optional().describe('简短的 toolCode 字符串（与 toolCodePath 二选一）。适合几行以内的简单代码。'),
    toolCodePath: z.string().optional().describe('toolCode 文件路径（与 toolCode 二选一，推荐用于复杂代码）。如 "generated/tools/word-match.js"'),
  }),
  execute: async ({ name, description, toolCode, toolCodePath }) => {
    const now = new Date();

    // Block names that conflict with built-in commands
    const builtinNames = ['review', 'add', 'stats', 'dev', 'rate'];
    if (builtinNames.includes(name)) {
      return { type: 'error', name, message: `命令 /${name} 与内置命令冲突，请换一个名称` };
    }

    // Resolve toolCode from either direct string or file path
    let resolvedToolCode: string;
    if (toolCodePath) {
      const fullPath = path.join(process.cwd(), toolCodePath);
      const normalized = path.normalize(fullPath);
      if (!normalized.startsWith(path.normalize(process.cwd()))) {
        return { type: 'error', message: '安全限制：toolCodePath 必须在项目目录内' };
      }
      try {
        resolvedToolCode = await fs.readFile(normalized, 'utf-8');
      } catch {
        return { type: 'error', message: `toolCode 文件不存在: ${toolCodePath}。请先用 file-write 写入代码文件。` };
      }
    } else if (toolCode) {
      resolvedToolCode = toolCode;
    } else {
      return { type: 'error', message: '必须提供 toolCode 或 toolCodePath 参数' };
    }

    try {
      // Check if command already exists
      const existing = await db
        .select()
        .from(dynamicCommands)
        .where(eq(dynamicCommands.name, name))
        .limit(1);

      if (existing.length > 0) {
        // Update existing command
        await db
          .update(dynamicCommands)
          .set({
            description,
            toolCode: resolvedToolCode,
            updatedAt: now,
          })
          .where(eq(dynamicCommands.name, name));

        return { type: 'updated', name, message: `命令 /${name} 已更新` };
      }

      // Create new command
      await db.insert(dynamicCommands).values({
        id: uuid(),
        name,
        description,
        toolCode: resolvedToolCode,
        componentCode: null,
        createdAt: now,
        updatedAt: now,
      });

      return { type: 'registered', name, message: `命令 /${name} 已注册。用户现在可以使用 /${name} 命令。` };
    } catch (error) {
      return { type: 'error', message: `注册失败: ${String(error)}` };
    }
  },
});
