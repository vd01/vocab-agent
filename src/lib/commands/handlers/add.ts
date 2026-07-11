/**
 * /add command — add a new word to the vocabulary.
 * Auto-fills phonetic/definition/examples from dictionary when available.
 */

import { db } from '@/lib/db';
import { words } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { initializeCard } from '@/lib/fsrs/scheduler';
import { lookupWord } from '@/lib/dictionary/lookup';
import { v4 as uuid } from 'uuid';
import type { CommandHandler, CommandResult } from '../executor';

export const addHandler: CommandHandler = {
  name: 'add',
  description: '添加新单词 (如: /add ephemeral 或 /add ephemeral 短暂的)',
  usage: '/add <word> [definition]',

  async execute(args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return { type: 'invalid-args', message: '用法: /add <word> [definition]' };
    }

    const wordText = args[0];
    const manualDefinition = args.slice(1).join(' ') || null;
    const normalized = wordText.toLowerCase();

    // Check if word already exists
    const existing = await db
      .select()
      .from(words)
      .where(eq(words.word, normalized))
      .limit(1);

    if (existing.length > 0) {
      return { type: 'already-exists', word: wordText, message: `单词 "${wordText}" 已在词库中` };
    }

    // Auto-fill from dictionary
    let autoData: Awaited<ReturnType<typeof lookupWord>> = null;
    let autoFilled = false;

    if (!manualDefinition) {
      autoData = await lookupWord(normalized);
    }

    // Merge: manual input takes priority
    let finalPhonetic: string | null = null;
    let finalDefinition = manualDefinition;
    let finalExamples: string[] | null = null;
    let finalTag: string | null = null;
    let finalCollins: number | null = null;
    let finalBnc: number | null = null;
    let finalFrq: number | null = null;
    let finalExchange: string | null = null;

    if (autoData) {
      if (autoData.phonetic) { finalPhonetic = autoData.phonetic; autoFilled = true; }
      if (autoData.translation) { finalDefinition = autoData.translation; autoFilled = true; }
      // Extract example sentences from API definitions
      if (autoData.definitions) {
        const exs: string[] = [];
        for (const group of autoData.definitions) {
          for (const def of group.definitions) {
            if (def.example) exs.push(def.example);
          }
        }
        if (exs.length > 0) { finalExamples = exs; autoFilled = true; }
      }
      // Always fill metadata from ECDICT if available
      if (autoData.tag) finalTag = autoData.tag;
      if (autoData.collins) finalCollins = autoData.collins;
      if (autoData.bnc) finalBnc = autoData.bnc;
      if (autoData.frq) finalFrq = autoData.frq;
      if (autoData.exchange) finalExchange = autoData.exchange;
    }

    // Still no definition? Use a placeholder
    if (!finalDefinition) {
      finalDefinition = '(暂无释义)';
    }

    const wordId = uuid();
    const now = new Date();

    await db.insert(words).values({
      id: wordId,
      word: normalized,
      phonetic: finalPhonetic,
      definition: finalDefinition,
      examples: finalExamples ? JSON.stringify(finalExamples) : null,
      source: autoFilled ? 'ecdict' : 'manual',
      tag: finalTag,
      collins: finalCollins,
      bnc: finalBnc,
      frq: finalFrq,
      exchange: finalExchange,
      createdAt: now,
    });

    // Initialize FSRS card
    await initializeCard(wordId);

    const fillInfo = autoFilled ? '（自动填充自词典）' : '';
    return {
      type: 'added',
      wordId,
      word: wordText,
      phonetic: finalPhonetic,
      definition: finalDefinition,
      examples: finalExamples,
      tag: finalTag,
      collins: finalCollins,
      message: `已添加单词 "${wordText}" 到词库，复习卡片已初始化${fillInfo}`,
    };
  },
};
