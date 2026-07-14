import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { updateRegistryFile, GENERATED_SRC_DIR } from './registry-utils';
import { db } from '@/lib/db';
import { dynamicCommands } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const unregisterComponentTool = tool({
  description: `从动态组件注册表中移除组件。会执行以下操作：
1. 删除 src/components/generated/ 下的组件文件
2. 自动重写 component-registry.ts（移除对应的动态 import 和 register 调用）
3. 清理 DB dynamic_commands 表中对应的 component_code

当 Developer agent 删除组件时，必须使用本工具而非直接删除文件，以确保注册表同步。`,
  inputSchema: z.object({
    name: z.string().describe('要移除的组件名称，如 "word-stats-panel"。必须与注册时使用的名称一致。'),
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

    // 3. Clean up DB dynamic_commands table
    try {
      const candidates = [name, name.replace(/-/g, '_')];
      for (const candidate of candidates) {
        const existing = await db.select().from(dynamicCommands)
          .where(eq(dynamicCommands.name, candidate)).limit(1);
        if (existing.length > 0 && existing[0].componentCode) {
          await db.update(dynamicCommands)
            .set({ componentCode: null, updatedAt: new Date() })
            .where(eq(dynamicCommands.name, candidate));
          results.push(`已清理 DB 中命令 "${candidate}" 的 component_code`);
          break;
        }
      }
    } catch (dbErr) {
      // DB cleanup is best-effort; don't fail the whole operation
      console.error('[unregister-component] DB cleanup failed:', dbErr);
      results.push(`DB 清理跳过: ${String(dbErr)}`);
    }

    return {
      type: 'unregistered',
      name,
      message: results.join('\n'),
    };
  },
});
