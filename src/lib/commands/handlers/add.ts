/**
 * /add command — add a new word to the vocabulary.
 * Auto-fills phonetic/definition/examples from dictionary when available.
 *
 * Usage: /add <word> [definition] [分组名]
 *   /add ephemeral
 *   /add ephemeral 短暂的
 *   /add ephemeral 短暂的 四级
 */

import { db } from '../../db';
import { words, wordGroups, wordGroupMembers } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { initializeCard } from '../../fsrs/scheduler';
import { lookupWord } from '../../dictionary/lookup';
import { v4 as uuid } from 'uuid';
import type { CommandHandler, CommandResult } from '../executor';

export const addHandler: CommandHandler = {
  name: 'add',
  description: '添加新单词 (如: /add ephemeral 或 /add ephemeral 短暂的 四级)',
  usage: '/add <word> [definition] [分组名]',

  async execute(args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return { type: 'invalid-args', message: '用法: /add <word> [definition] [分组名]' };
    }

    const wordText = args[0];
    // Last arg could be a group name if it matches an existing group
    let groupName: string | undefined;
    let definitionArgs = args.slice(1);

    // Check if the last arg is a known group name
    if (definitionArgs.length > 0) {
      const lastArg = definitionArgs[definitionArgs.length - 1];
      const group = await db
        .select({ id: wordGroups.id })
        .from(wordGroups)
        .where(eq(wordGroups.name, lastArg))
        .limit(1);
      if (group.length > 0) {
        groupName = lastArg;
        definitionArgs = definitionArgs.slice(0, -1);
      }
    }

    const manualDefinition = definitionArgs.join(' ') || null;
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
    let finalAudioUrl: string | null = null;
    let finalDefinition = manualDefinition;
    let finalExamples: string[] | null = null;
    let finalTag: string | null = null;
    let finalCollins: number | null = null;
    let finalBnc: number | null = null;
    let finalFrq: number | null = null;
    let finalExchange: string | null = null;

    if (autoData) {
      if (autoData.phonetic) { finalPhonetic = autoData.phonetic; autoFilled = true; }
      if (autoData.audioUrl) { finalAudioUrl = autoData.audioUrl; }
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
      audioUrl: finalAudioUrl,
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

    // Assign to group
    const targetGroupName = groupName?.trim() || '日常';
    let assignedGroup = targetGroupName;
    try {
      const targetGroup = await db
        .select()
        .from(wordGroups)
        .where(eq(wordGroups.name, targetGroupName))
        .limit(1);

      let targetGroupId: string;
      if (targetGroup.length > 0) {
        targetGroupId = targetGroup[0].id;
      } else {
        targetGroupId = uuid();
        await db.insert(wordGroups).values({
          id: targetGroupId,
          name: targetGroupName,
          isDefault: 0,
          createdAt: new Date(),
        });
      }

      await db.insert(wordGroupMembers).values({
        id: uuid(),
        groupId: targetGroupId,
        wordId,
        addedAt: new Date(),
      });
    } catch (err) {
      console.error('[add] Group assignment failed:', err);
      assignedGroup = '日常';
    }

    const fillInfo = autoFilled ? '（自动填充自词典）' : '';
    return {
      type: 'added',
      wordId,
      word: wordText,
      phonetic: finalPhonetic,
      audioUrl: finalAudioUrl,
      definition: finalDefinition,
      examples: finalExamples,
      tag: finalTag,
      collins: finalCollins,
      group: assignedGroup,
      message: `已添加单词 "${wordText}" 到词库（分组：${assignedGroup}），复习卡片已初始化${fillInfo}`,
    };
  },
};
