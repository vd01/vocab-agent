import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db';
import { pinnedWords, words } from '@/lib/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { lookupWord } from '@/lib/dictionary/lookup';
import { initializeCard } from '@/lib/fsrs/scheduler';

const MAX_PINS_PER_SIDE = 5;

export const pinWordTool = tool({
  description: '将单词置顶到侧边栏，方便用户随时查看和复习。置顶的单词会显示在 PC 界面两侧，点击可展开 AI 生成的详解卡片（助记、词族、搭配、例句等）。如果单词不在词库中，会自动添加。',
  inputSchema: z.object({
    wordId: z.string().optional().describe('要置顶的单词 ID（如果已在词库中）'),
    word: z.string().optional().describe('要置顶的单词文本（如果不在词库中，会自动添加）'),
    side: z.enum(['left', 'right']).optional().describe('放在哪一侧，默认 left'),
  }),
  execute: async ({ wordId, word: wordText, side = 'left' }) => {
    let targetWordId = wordId;
    let autoAdded = false;

    if (!targetWordId && wordText) {
      const normalized = wordText.toLowerCase();
      const existing = await db
        .select()
        .from(words)
        .where(eq(words.word, normalized))
        .limit(1);

      if (existing.length > 0) {
        targetWordId = existing[0].id;
      } else {
        const autoData = await lookupWord(normalized);
        let finalPhonetic: string | null = null;
        let finalDefinition = '(暂无释义)';
        let finalExamples: string[] | null = null;
        let finalTag: string | null = null;
        let finalCollins: number | null = null;
        let finalBnc: number | null = null;
        let finalFrq: number | null = null;
        let finalExchange: string | null = null;

        if (autoData) {
          if (autoData.phonetic) finalPhonetic = autoData.phonetic;
          if (autoData.translation) finalDefinition = autoData.translation;
          if (autoData.definitions) {
            const exs: string[] = [];
            for (const group of autoData.definitions) {
              for (const def of group.definitions) {
                if (def.example) exs.push(def.example);
              }
            }
            if (exs.length > 0) finalExamples = exs;
          }
          if (autoData.tag) finalTag = autoData.tag;
          if (autoData.collins) finalCollins = autoData.collins;
          if (autoData.bnc) finalBnc = autoData.bnc;
          if (autoData.frq) finalFrq = autoData.frq;
          if (autoData.exchange) finalExchange = autoData.exchange;
        }

        const newId = uuid();
        await db.insert(words).values({
          id: newId,
          word: normalized,
          phonetic: finalPhonetic,
          definition: finalDefinition,
          examples: finalExamples ? JSON.stringify(finalExamples) : null,
          source: autoData ? 'ecdict' : 'manual',
          tag: finalTag,
          collins: finalCollins,
          bnc: finalBnc,
          frq: finalFrq,
          exchange: finalExchange,
          createdAt: new Date(),
        });
        await initializeCard(newId);
        targetWordId = newId;
        autoAdded = true;
      }
    }

    if (!targetWordId) {
      return { type: 'error', message: '请提供 wordId 或 word 参数' };
    }

    const existingWord = await db
      .select()
      .from(words)
      .where(eq(words.id, targetWordId))
      .limit(1);

    if (existingWord.length === 0) {
      return { type: 'error', message: `未找到 ID 为 "${targetWordId}" 的单词` };
    }

    const w = existingWord[0];

    const alreadyPinned = await db
      .select()
      .from(pinnedWords)
      .where(eq(pinnedWords.wordId, w.id))
      .limit(1);

    if (alreadyPinned.length > 0) {
      if (alreadyPinned[0].archivedAt) {
        await db
          .update(pinnedWords)
          .set({ archivedAt: null, side, position: 0 })
          .where(eq(pinnedWords.id, alreadyPinned[0].id));
        const repositioned = await db
          .select()
          .from(pinnedWords)
          .where(sql`${pinnedWords.side} = ${side} AND ${pinnedWords.archivedAt} IS NULL`)
          .orderBy(asc(pinnedWords.position));
        for (let i = 0; i < repositioned.length; i++) {
          if (repositioned[i].position !== i) {
            await db
              .update(pinnedWords)
              .set({ position: i })
              .where(eq(pinnedWords.id, repositioned[i].id));
          }
        }
        return {
          type: 'pinned',
          pinId: alreadyPinned[0].id,
          wordId: w.id,
          word: w.word,
          phonetic: w.phonetic,
          definition: w.definition,
          side,
          message: `已将 "${w.word}" 从归档恢复并置顶到${side === 'left' ? '左' : '右'}侧栏`,
        };
      }
      return { type: 'already-pinned', word: w.word, message: `单词 "${w.word}" 已在置顶列表中` };
    }

    const sidePins = await db
      .select()
      .from(pinnedWords)
      .where(sql`${pinnedWords.side} = ${side} AND ${pinnedWords.archivedAt} IS NULL`)
      .orderBy(asc(pinnedWords.position));

    if (sidePins.length >= MAX_PINS_PER_SIDE) {
      const otherSide = side === 'left' ? 'right' : 'left';
      const otherSidePins = await db
        .select()
        .from(pinnedWords)
        .where(sql`${pinnedWords.side} = ${otherSide} AND ${pinnedWords.archivedAt} IS NULL`)
        .orderBy(asc(pinnedWords.position));

      if (otherSidePins.length >= MAX_PINS_PER_SIDE) {
        return {
          type: 'full',
          word: w.word,
          message: `两侧置顶都已满（每侧最多 ${MAX_PINS_PER_SIDE} 个），请先归档或移除旧的置顶单词`,
          maxPerSide: MAX_PINS_PER_SIDE,
        };
      }
      return pinToSide(w, otherSide, otherSidePins, autoAdded);
    }

    return pinToSide(w, side, sidePins, autoAdded);
  },
});

async function pinToSide(w: typeof words.$inferSelect, side: 'left' | 'right', sidePins: any[], autoAdded: boolean) {
  const maxPos = sidePins.length > 0
    ? Math.max(...sidePins.map(p => p.position))
    : -1;

  const pinId = uuid();

  await db.insert(pinnedWords).values({
    id: pinId,
    wordId: w.id,
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
    wordId: w.id,
    word: w.word,
    phonetic: w.phonetic,
    definition: w.definition,
    side,
    message: autoAdded
      ? `已添加并置顶 "${w.word}" 到${side === 'left' ? '左' : '右'}侧栏`
      : `已将 "${w.word}" 置顶到${side === 'left' ? '左' : '右'}侧栏`,
  };
}

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
      .where(sql`${pinnedWords.side} = ${side} AND ${pinnedWords.archivedAt} IS NULL`)
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
