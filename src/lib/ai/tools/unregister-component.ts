import { defineTool } from './types';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { updateRegistryFile, GENERATED_SRC_DIR, GENERATED_TOOLS_DIR } from './registry-utils';
import { db } from '../../db';
import { dynamicCommands } from '../../db/schema';
import { eq } from 'drizzle-orm';

export const unregisterComponentTool = defineTool({
  description: `删除一个 / 命令及其关联的 UI 组件。会执行以下操作：
1. 删除 src/components/generated/ 下的组件文件
2. 删除 generated/tools/ 下的 toolCode 文件
3. 重写 component-registry.ts（移除对应的动态 import 和 register 调用）
4. 删除 DB dynamic_commands 表中的整条记录

当 Developer agent 删除命令时，必须使用本工具而非直接删除文件，以确保注册表和 DB 同步。`,
  inputSchema: z.object({
    name: z.string().describe('要删除的命令名称（不含 / 前缀），如 "word-stats"。必须与注册时使用的名称一致。'),
  }),
  execute: async ({ name }) => {
    const results: string[] = [];

    // 1. Delete the component file
    const componentPath = path.join(GENERATED_SRC_DIR, `${name}.tsx`);
    const componentPathAlt = path.join(GENERATED_SRC_DIR, `${name}.ts`);
    let fileDeleted = false;

    for (const p of [componentPath, componentPathAlt]) {
      try {
        await fs.access(p);
        await fs.unlink(p);
        results.push(`已删除组件文件: ${path.relative(process.cwd(), p)}`);
        fileDeleted = true;
        break;
      } catch {
        // File doesn't exist, try next
      }
    }

    if (!fileDeleted) {
      results.push(`组件文件不存在: src/components/generated/${name}.tsx（可能已被删除）`);
    }

    // 2. Rewrite component-registry.ts (removes the dynamic import + register for this component)
    try {
      await updateRegistryFile();
      results.push('已更新 component-registry.ts');
    } catch (err) {
      results.push(`更新 registry 失败: ${String(err)}`);
    }

    // 3. Delete toolCode file from generated/tools/
    const toolCodePath = path.join(GENERATED_TOOLS_DIR, `${name}.js`);
    try {
      await fs.access(toolCodePath);
      await fs.unlink(toolCodePath);
      results.push(`已删除 toolCode 文件: generated/tools/${name}.js`);
    } catch {
      results.push(`toolCode 文件不存在: generated/tools/${name}.js（可能已被删除）`);
    }

    // 4. Delete DB record entirely
    try {
      const candidates = [name, name.replace(/-/g, '_')];
      for (const candidate of candidates) {
        const existing = await db.select().from(dynamicCommands)
          .where(eq(dynamicCommands.name, candidate)).limit(1);
        if (existing.length > 0) {
          await db.delete(dynamicCommands)
            .where(eq(dynamicCommands.name, candidate));
          results.push(`已从 DB 删除命令 "${candidate}"`);
          break;
        }
      }
    } catch (dbErr) {
      console.error('[unregister-component] DB delete failed:', dbErr);
      results.push(`DB 删除失败: ${String(dbErr)}`);
    }

    return {
      type: 'unregistered',
      name,
      message: results.join('\n'),
    };
  },
});
