import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db';
import { developerLessons } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';

export const listLessonsTool = tool({
  description: '列出知识库中所有经验教训，用于检查冗余和合并机会。当你需要了解当前知识库内容、判断是否有重复经验时调用。',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const lessons = await db
        .select()
        .from(developerLessons)
        .orderBy(desc(developerLessons.createdAt));

      if (lessons.length === 0) {
        return { type: 'lesson-list', count: 0, lessons: [], message: '知识库为空，暂无经验教训' };
      }

      return {
        type: 'lesson-list',
        count: lessons.length,
        lessons: lessons.map(l => ({
          id: l.id,
          category: l.category,
          title: l.title,
          content: l.content.length > 100 ? l.content.slice(0, 100) + '...' : l.content,
          context: l.context,
        })),
        message: `知识库共 ${lessons.length} 条经验教训`,
      };
    } catch (error) {
      return { type: 'error', message: `查询经验教训失败: ${String(error)}` };
    }
  },
});
