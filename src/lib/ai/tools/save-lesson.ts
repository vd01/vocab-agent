import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db';
import { developerLessons } from '@/lib/db/schema';
import { v4 as uuid } from 'uuid';
import { eq, desc } from 'drizzle-orm';

export const saveLessonTool = tool({
  description: '保存经验教训到知识库，供未来开发任务参考。在完成开发任务后，主动总结并保存你学到的经验。',
  inputSchema: z.object({
    category: z.enum(['pattern', 'anti-pattern', 'tip', 'pitfall']).describe(
      '经验类别: pattern=成功模式, anti-pattern=应避免的做法, tip=实用技巧, pitfall=常见陷阱'
    ),
    title: z.string().describe('简短标题，如 "组件名必须与 type 匹配"'),
    content: z.string().describe('详细描述，包含具体做法和原因'),
    context: z.string().optional().describe('触发场景，如 "注册新命令时"'),
  }),
  execute: async ({ category, title, content, context }) => {
    try {
      // Check for duplicate by title
      const existing = await db
        .select()
        .from(developerLessons)
        .where(eq(developerLessons.title, title))
        .limit(1);

      if (existing.length > 0) {
        // Update existing lesson
        await db
          .update(developerLessons)
          .set({ category, content, context: context ?? null })
          .where(eq(developerLessons.title, title));

        return { type: 'updated', message: `经验 "${title}" 已更新` };
      }

      // Create new lesson
      await db.insert(developerLessons).values({
        id: uuid(),
        category,
        title,
        content,
        context: context ?? null,
        createdAt: new Date(),
      });

      return { type: 'saved', message: `经验 "${title}" 已保存到知识库` };
    } catch (error) {
      return { type: 'error', message: `保存经验失败: ${String(error)}` };
    }
  },
});

/**
 * Load developer lessons from DB, formatted for system prompt injection.
 * Respects a character budget to avoid inflating the prompt.
 * Prioritizes pitfall > anti-pattern > pattern > tip (most impactful first).
 */
export async function loadDeveloperLessons(maxChars: number = 3000): Promise<string> {
  try {
    const lessons = await db
      .select()
      .from(developerLessons)
      .orderBy(desc(developerLessons.createdAt));

    if (lessons.length === 0) return '';

    // Sort by priority: pitfall and anti-pattern are most important for agent behavior
    const priorityOrder: Record<string, number> = { pitfall: 0, 'anti-pattern': 1, pattern: 2, tip: 3 };
    const sorted = [...lessons].sort((a, b) =>
      (priorityOrder[a.category] ?? 9) - (priorityOrder[b.category] ?? 9)
    );

    const categoryLabels: Record<string, string> = {
      pattern: '✅ 成功模式',
      'anti-pattern': '❌ 应避免的做法',
      tip: '💡 实用技巧',
      pitfall: '⚠️ 常见陷阱',
    };

    // Group by category, respecting budget
    const grouped: Record<string, Array<{ title: string; content: string; context: string | null }>> = {
      pitfall: [],
      'anti-pattern': [],
      pattern: [],
      tip: [],
    };

    let totalChars = 0;
    let includedCount = 0;

    for (const l of sorted) {
      const entry = `- **${l.title}**${l.context ? `（${l.context}）` : ''}: ${l.content}`;
      if (totalChars + entry.length > maxChars) break;
      const cat = l.category as keyof typeof grouped;
      if (grouped[cat]) {
        grouped[cat].push({ title: l.title, content: l.content, context: l.context });
      }
      totalChars += entry.length;
      includedCount++;
    }

    const sections: string[] = [];
    for (const [cat, items] of Object.entries(grouped)) {
      if (items.length === 0) continue;
      sections.push(`### ${categoryLabels[cat] ?? cat}`);
      for (const item of items) {
        const ctx = item.context ? `（${item.context}）` : '';
        sections.push(`- **${item.title}**${ctx}: ${item.content}`);
      }
    }

    if (includedCount < lessons.length) {
      sections.push(`\n[...还有 ${lessons.length - includedCount} 条经验，因篇幅限制已省略。可用 list-lessons 工具查看全部。]`);
    }

    return sections.join('\n');
  } catch {
    return '';
  }
}
