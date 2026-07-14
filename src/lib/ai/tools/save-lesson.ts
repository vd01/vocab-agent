import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db';
import { developerLessons } from '@/lib/db/schema';
import { v4 as uuid } from 'uuid';
import { eq, desc } from 'drizzle-orm';
import { estimateTokens } from '../utils/token-estimate';

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
 *
 * Priority ordering:
 * 1. Category: pitfall > anti-pattern > pattern > tip
 * 2. Recency: recently used lessons rank higher; lessons unused for >30 days
 *    are deprioritized (decay factor).
 *
 * After loading, updates lastUsedAt for all included lessons.
 */
export async function loadDeveloperLessons(maxTokens: number = 1500): Promise<string> {
  try {
    const lessons = await db
      .select()
      .from(developerLessons)
      .orderBy(desc(developerLessons.createdAt));

    if (lessons.length === 0) return '';

    const now = Date.now();
    const DECAY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

    // Sort by priority: category + recency decay
    const priorityOrder: Record<string, number> = { pitfall: 0, 'anti-pattern': 1, pattern: 2, tip: 3 };
    const sorted = [...lessons].sort((a, b) => {
      // Primary: category priority
      const catDiff = (priorityOrder[a.category] ?? 9) - (priorityOrder[b.category] ?? 9);
      if (catDiff !== 0) return catDiff;

      // Secondary: recency — recently used lessons rank higher
      const aLastUsed = a.lastUsedAt ? a.lastUsedAt.getTime() : 0;
      const bLastUsed = b.lastUsedAt ? b.lastUsedAt.getTime() : 0;

      // Lessons unused for >30 days get a penalty (pushed to end of their category group)
      const aDecayed = (now - aLastUsed) > DECAY_THRESHOLD_MS;
      const bDecayed = (now - bLastUsed) > DECAY_THRESHOLD_MS;
      if (aDecayed !== bDecayed) return aDecayed ? 1 : -1;

      // Within same decay status, prefer more recently used
      return bLastUsed - aLastUsed;
    });

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

    let totalTokens = 0;
    let includedCount = 0;

    for (const l of sorted) {
      const entry = `- **${l.title}**${l.context ? `（${l.context}）` : ''}: ${l.content}`;
      const entryTokens = estimateTokens(entry);
      if (totalTokens + entryTokens > maxTokens) break;
      const cat = l.category as keyof typeof grouped;
      if (grouped[cat]) {
        grouped[cat].push({ title: l.title, content: l.content, context: l.context });
      }
      totalTokens += entryTokens;
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

    // Update lastUsedAt for included lessons (fire-and-forget)
    const includedIds = sorted.slice(0, includedCount).map(l => l.id);
    if (includedIds.length > 0) {
      const nowTimestamp = new Date();
      Promise.all(
        includedIds.map(id =>
          db.update(developerLessons)
            .set({ lastUsedAt: nowTimestamp })
            .where(eq(developerLessons.id, id))
        )
      ).catch(err => console.error('[loadDeveloperLessons] Failed to update lastUsedAt:', err));
    }

    return sections.join('\n');
  } catch {
    return '';
  }
}
