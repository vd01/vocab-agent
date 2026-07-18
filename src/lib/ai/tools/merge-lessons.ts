import { defineTool } from './types';
import { z } from 'zod';
import { db } from '../../db';
import { developerLessons } from '../../db/schema';
import { eq, inArray } from 'drizzle-orm';

export const mergeLessonsTool = defineTool({
  description: '合并冗余的经验教训。当你发现知识库中有多条语义重复或高度相关的经验时，调用此工具将它们合并为一条更精炼的经验。合并后会删除被合并的旧条目。',
  inputSchema: z.object({
    keepId: z.string().describe('保留的教训 ID（合并后的主记录）'),
    mergeIds: z.array(z.string()).describe('要合并删除的教训 ID 列表'),
    mergedTitle: z.string().describe('合并后的标题'),
    mergedContent: z.string().describe('合并后的内容（综合各条精华，精炼表述）'),
    mergedCategory: z.enum(['pattern', 'anti-pattern', 'tip', 'pitfall']).describe('合并后的类别'),
    mergedContext: z.string().optional().describe('合并后的触发场景'),
  }),
  execute: async ({ keepId, mergeIds, mergedTitle, mergedContent, mergedCategory, mergedContext }) => {
    try {
      // Verify keepId exists
      const keepRecord = await db
        .select()
        .from(developerLessons)
        .where(eq(developerLessons.id, keepId))
        .limit(1);

      if (keepRecord.length === 0) {
        return { type: 'error', message: `未找到 ID 为 ${keepId} 的经验教训` };
      }

      // Update the kept record with merged content
      await db
        .update(developerLessons)
        .set({
          title: mergedTitle,
          content: mergedContent,
          category: mergedCategory,
          context: mergedContext ?? null,
        })
        .where(eq(developerLessons.id, keepId));

      // Delete the merged records
      if (mergeIds.length > 0) {
        await db
          .delete(developerLessons)
          .where(inArray(developerLessons.id, mergeIds));
      }

      return {
        type: 'merged',
        message: `已将 ${mergeIds.length} 条经验合并到 "${mergedTitle}"，删除了 ${mergeIds.length} 条冗余记录`,
        keptId: keepId,
        deletedIds: mergeIds,
      };
    } catch (error) {
      return { type: 'error', message: `合并经验教训失败: ${String(error)}` };
    }
  },
});
