import { db } from '@/lib/db';
import { pinnedWords, words } from '@/lib/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { lookupWord } from '@/lib/dictionary/lookup';
import { initializeCard } from '@/lib/fsrs/scheduler';
import type { CommandHandler, CommandResult } from '../executor';

const MAX_PINS_PER_SIDE = 5;

export const pinHandler: CommandHandler = {
  name: 'pin',
  description: '置顶单词到侧边栏 (如: /pin ephemeral)，不在词库中会自动添加',
  usage: '/pin <word>',

  async execute(args: string[]): Promise<CommandResult> {
    const wordText = args.join(' ').toLowerCase();
    if (!wordText) return { type: 'invalid-args', message: '用法: /pin <word>' };
    return pinWord(wordText);
  },
};

async function pinWord(wordText: string): Promise<CommandResult> {
  let existing = await db
    .select()
    .from(words)
    .where(eq(words.word, wordText))
    .limit(1);

  let autoAdded = false;
  let w;

  if (existing.length === 0) {
    const autoData = await lookupWord(wordText);
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

    const wordId = uuid();
    await db.insert(words).values({
      id: wordId,
      word: wordText,
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
    await initializeCard(wordId);

    existing = await db.select().from(words).where(eq(words.id, wordId)).limit(1);
    autoAdded = true;
  }

  w = existing[0];

  const alreadyPinned = await db
    .select()
    .from(pinnedWords)
    .where(eq(pinnedWords.wordId, w.id))
    .limit(1);

  if (alreadyPinned.length > 0) {
    if (alreadyPinned[0].archivedAt) {
      await db
        .update(pinnedWords)
        .set({ archivedAt: null, side: 'left', position: 0 })
        .where(eq(pinnedWords.id, alreadyPinned[0].id));
      const repositioned = await db
        .select()
        .from(pinnedWords)
        .where(sql`${pinnedWords.side} = 'left' AND ${pinnedWords.archivedAt} IS NULL`)
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
        wordId: w.id,
        word: w.word,
        phonetic: w.phonetic,
        definition: w.definition,
        message: `已将 "${w.word}" 从归档恢复并置顶到左侧栏`,
      };
    }
    return { type: 'already-pinned', word: w.word, message: `单词 "${w.word}" 已在置顶列表中` };
  }

  const side: 'left' | 'right' = 'left';
  const sidePins = await db
    .select()
    .from(pinnedWords)
    .where(sql`${pinnedWords.side} = ${side} AND ${pinnedWords.archivedAt} IS NULL`)
    .orderBy(asc(pinnedWords.position));

  let finalSide: 'left' | 'right' = side;
  if (sidePins.length >= MAX_PINS_PER_SIDE) {
    const rightPins = await db
      .select()
      .from(pinnedWords)
      .where(sql`${pinnedWords.side} = 'right' AND ${pinnedWords.archivedAt} IS NULL`)
      .orderBy(asc(pinnedWords.position));
    if (rightPins.length >= MAX_PINS_PER_SIDE) {
      return {
        type: 'pin-full',
        word: w.word,
        message: `两侧置顶都已满（每侧最多 ${MAX_PINS_PER_SIDE} 个），请先归档或移除旧的置顶单词`,
      };
    }
    finalSide = 'right';
  }

  const targetPins = finalSide === 'left' ? sidePins : await db
    .select()
    .from(pinnedWords)
    .where(sql`${pinnedWords.side} = ${finalSide} AND ${pinnedWords.archivedAt} IS NULL`)
    .orderBy(asc(pinnedWords.position));

  const maxPos = targetPins.length > 0 ? Math.max(...targetPins.map(p => p.position)) : -1;
  const pinId = uuid();

  await db.insert(pinnedWords).values({
    id: pinId,
    wordId: w.id,
    word: w.word,
    phonetic: w.phonetic,
    definition: w.definition,
    position: maxPos + 1,
    side: finalSide,
    richContent: null,
    createdAt: new Date(),
  });

  return {
    type: 'pinned',
    wordId: w.id,
    word: w.word,
    phonetic: w.phonetic,
    definition: w.definition,
    message: autoAdded
      ? `已添加并置顶 "${w.word}" 到${finalSide === 'left' ? '左' : '右'}侧栏`
      : `已将 "${w.word}" 置顶到${finalSide === 'left' ? '左' : '右'}侧栏`,
  };
}
