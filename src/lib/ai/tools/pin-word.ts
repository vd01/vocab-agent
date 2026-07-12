import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db';
import { pinnedWords, words } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const MAX_PINS_PER_SIDE = 5;

export const pinWordTool = tool({
  description: '将单词置顶到侧边栏，方便用户随时查看和复习。置顶的单词会显示在 PC 界面两侧，点击可展开 AI 生成的详解卡片（助记、词族、搭配、例句等）。',
  inputSchema: z.object({
    wordId: z.string().describe('要置顶的单词 ID（来自 add-word 或 vocab-lookup 返回的 wordId）'),
    side: z.enum(['left', 'right']).optional().describe('放在哪一侧，默认 left'),
  }),
  execute: async ({ wordId, side = 'left' }) => {
    const existingWord = await db
      .select()
      .from(words)
      .where(eq(words.id, wordId))
      .limit(1);

    if (existingWord.length === 0) {
      return { type: 'error', message: `未找到 ID 为 "${wordId}" 的单词` };
    }

    const alreadyPinned = await db
      .select()
      .from(pinnedWords)
      .where(eq(pinnedWords.wordId, wordId))
      .limit(1);

    if (alreadyPinned.length > 0) {
      return { type: 'already-pinned', word: existingWord[0].word, message: `单词 "${existingWord[0].word}" 已在置顶列表中` };
    }

    const sidePins = await db
      .select()
      .from(pinnedWords)
      .where(eq(pinnedWords.side, side))
      .orderBy(asc(pinnedWords.position));

    if (sidePins.length >= MAX_PINS_PER_SIDE) {
      return {
        type: 'full',
        word: existingWord[0].word,
        message: `${side === 'left' ? '左' : '右'}侧置顶已满（最多 ${MAX_PINS_PER_SIDE} 个），请先移除旧的置顶单词`,
        maxPerSide: MAX_PINS_PER_SIDE,
      };
    }

    const maxPos = sidePins.length > 0
      ? Math.max(...sidePins.map(p => p.position))
      : -1;

    const w = existingWord[0];
    const pinId = uuid();

    await db.insert(pinnedWords).values({
      id: pinId,
      wordId,
      word: w.word,
      phonetic: w.phonetic,
      definition: w.definition,
      position: maxPos + 1,
      side,
      richContent: null,
      createdAt: new Date(),
    });

    return {
      type: 'pinned',
      pinId,
      word: w.word,
      side,
      message: `已将 "${w.word}" 置顶到${side === 'left' ? '左' : '右'}侧栏`,
    };
  },
});

export const unpinWordTool = tool({
  description: '取消单词的置顶状态，从侧边栏移除。',
  inputSchema: z.object({
    pinId: z.string().describe('置顶记录 ID（来自 pin-word 返回的 pinId）'),
  }),
  execute: async ({ pinId }) => {
    const existing = await db
      .select()
      .from(pinnedWords)
      .where(eq(pinnedWords.id, pinId))
      .limit(1);

    if (existing.length === 0) {
      return { type: 'error', message: `未找到置顶记录 "${pinId}"` };
    }

    await db.delete(pinnedWords).where(eq(pinnedWords.id, pinId));

    const side = existing[0].side;
    const remaining = await db
      .select()
      .from(pinnedWords)
      .where(eq(pinnedWords.side, side))
      .orderBy(asc(pinnedWords.position));

    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].position !== i) {
        await db
          .update(pinnedWords)
          .set({ position: i })
          .where(eq(pinnedWords.id, remaining[i].id));
      }
    }

    return {
      type: 'unpinned',
      word: existing[0].word,
      message: `已取消 "${existing[0].word}" 的置顶`,
    };
  },
});
