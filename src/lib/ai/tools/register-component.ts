import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { GENERATED_SRC_DIR } from './registry-utils';

export const registerComponentTool = tool({
  description: `注册新的 UI 组件到动态组件注册表，立即生效（无需重启）。同时更新 DB 中的 component_code。

		**推荐使用 create-command 代替本工具**，它一步完成命令注册和组件注册。

		如果单独使用本工具，提供组件代码的方式有两种（二选一）：
		1. code: 直接传入简短的组件代码字符串（适合几行以内的简单组件）
		2. codePath: 传入组件代码文件路径（推荐！适合复杂组件代码，避免 JSON 转义问题）`,
  inputSchema: z.object({
    name: z.string().describe('组件名称，如 "word-stats-panel"。必须与命令返回的 type 字段匹配才能自动渲染。'),
    code: z.string().optional().describe('简短的 React 组件代码（与 codePath 二选一）。必须包含默认导出，使用 Tailwind CSS 样式。'),
    codePath: z.string().optional().describe('组件代码文件路径（与 code 二选一，推荐用于复杂组件）。如 "generated/components/word-match-panel.tsx"'),
  }),
  execute: async ({ name, code, codePath }) => {
    // Resolve code from either direct string or file path
    let componentCode: string;
    if (codePath) {
      const fullPath = path.join(process.cwd(), codePath);
      const normalized = path.normalize(fullPath);
      if (!normalized.startsWith(path.normalize(process.cwd()))) {
        return { type: 'error', message: '安全限制：codePath 必须在项目目录内' };
      }
      try {
        componentCode = await fs.readFile(normalized, 'utf-8');
      } catch {
        return { type: 'error', message: `组件代码文件不存在: ${codePath}。请先用 file-write 写入代码文件。` };
      }
    } else if (code) {
      componentCode = code;
    } else {
      return { type: 'error', message: '必须提供 code 或 codePath 参数' };
    }

    try {
      // 1. Save the component code to src/components/generated/
      await fs.mkdir(GENERATED_SRC_DIR, { recursive: true });
      const componentPath = path.join(GENERATED_SRC_DIR, `${name}.tsx`);
      await fs.writeFile(componentPath, componentCode, 'utf-8');

      // 2. Update the dynamic_commands table if a matching command exists
      try {
        const { db } = await import('@/lib/db');
        const { dynamicCommands } = await import('@/lib/db/schema');
        const { eq } = await import('drizzle-orm');
        const now = new Date();

        const candidates = [name, name.replace(/-/g, '_')];
        for (const candidate of candidates) {
          const existing = await db.select().from(dynamicCommands)
            .where(eq(dynamicCommands.name, candidate)).limit(1);
          if (existing.length > 0) {
            await db.update(dynamicCommands)
              .set({ componentCode: componentCode, updatedAt: now })
              .where(eq(dynamicCommands.name, candidate));
            break;
          }
        }
      } catch (dbErr) {
        console.error('[register-component] DB update failed:', dbErr);
      }

      return {
        type: 'registered',
        name,
        message: `组件 "${name}" 已注册。前端会在下次对话时自动加载新组件。`,
      };
    } catch (error) {
      return { type: 'error', message: `注册组件失败: ${String(error)}` };
    }
  },
});
