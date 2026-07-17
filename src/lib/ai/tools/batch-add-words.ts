import { defineTool } from './types';
import { z } from 'zod';
import { db } from '@/lib/db';
import { words, wordGroups, wordGroupMembers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { initializeCard } from '@/lib/fsrs/scheduler';
import { ecdictBatchLookup } from '@/lib/dictionary/ecdict';
import { v4 as uuid } from 'uuid';

interface AddResult {
  type: 'added' | 'already-exists' | 'error';
  word: string;
  wordId?: string;
  phonetic?: string | null;
  audioUrl?: string | null;
  definition?: string | null;
  examples?: any;
  tag?: string | null;
  collins?: number | null;
  group?: string;
  message: string;
}

export const batchAddWordsTool = defineTool({
  description: '批量添加多个单词到词库。比逐个调用 add-word 更高效，避免并发问题和 API 限流。只需提供单词列表，音标、释义等会自动从词典填充。',
  inputSchema: z.object({
    words: z.array(z.string()).describe('要添加的英语单词列表'),
    group: z.string().optional().describe('添加到指定分组（分组名），默认"日常"'),
  }),
  execute: async ({ words: wordList, group }) => {
    if (!wordList || wordList.length === 0) {
      return { type: 'error', message: '单词列表为空' };
    }

    const groupName = group?.trim() || '日常';
    const results: AddResult[] = [];

    // 1. Check which words already exist (batch query)
    const normalized = wordList.map(w => w.toLowerCase().trim()).filter(Boolean);
    const CHUNK = 200;
    const existingSet = new Set<string>();

    for (let i = 0; i < normalized.length; i += CHUNK) {
      const chunk = normalized.slice(i, i + CHUNK);
      const existing = await db
        .select({ word: words.word })
        .from(words)
        .where(inArray(words.word, chunk));
      for (const row of existing) {
        existingSet.add(row.word);
      }
    }

    // 2. Batch lookup all unknown words in ECDICT (single query, no API calls)
    const unknownWords = normalized.filter(w => !existingSet.has(w));
    const ecdictResults = await ecdictBatchLookup(unknownWords);

    // 3. Ensure the target group exists
    let targetGroupId: string;
    const targetGroup = await db
      .select()
      .from(wordGroups)
      .where(eq(wordGroups.name, groupName))
      .limit(1);

    if (targetGroup.length > 0) {
      targetGroupId = targetGroup[0].id;
    } else {
      targetGroupId = uuid();
      await db.insert(wordGroups).values({
        id: targetGroupId,
        name: groupName,
        isDefault: 0,
        createdAt: new Date(),
      });
    }

    // 4. Add each unknown word sequentially (safe for SQLite)
    const now = new Date();
    let addedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const wordText of normalized) {
      // Already exists
      if (existingSet.has(wordText)) {
        results.push({
          type: 'already-exists',
          word: wordText,
          message: `单词 "${wordText}" 已在词库中`,
        });
        skippedCount++;
        continue;
      }

      // Look up in ECDICT results
      const ecdictEntry = ecdictResults.get(wordText);
      if (!ecdictEntry || !ecdictEntry.translation) {
        results.push({
          type: 'error',
          word: wordText,
          message: `无法添加 "${wordText}"：词典中未找到释义`,
        });
        errorCount++;
        continue;
      }

      // Extract examples from ECDICT definition if available
      let finalExamples: string[] | null = null;
      if (ecdictEntry.definition) {
        const exs = ecdictEntry.definition
          .split('\n')
          .filter(line => line.includes('—') || line.length > 50); // Heuristic: likely example sentences
        if (exs.length > 0) finalExamples = exs.slice(0, 3);
      }

      const wordId = uuid();

      try {
        await db.insert(words).values({
          id: wordId,
          word: wordText,
          phonetic: ecdictEntry.phonetic ?? null,
          audioUrl: null, // No API call, so no audio URL
          definition: ecdictEntry.translation,
          examples: finalExamples ? JSON.stringify(finalExamples) : null,
          source: 'ecdict',
          tag: ecdictEntry.tag ?? null,
          collins: ecdictEntry.collins ?? null,
          bnc: ecdictEntry.bnc ?? null,
          frq: ecdictEntry.frq ?? null,
          exchange: ecdictEntry.exchange ?? null,
          createdAt: now,
        });

        // Initialize FSRS card
        await initializeCard(wordId);

        // Assign to group
        try {
          await db.insert(wordGroupMembers).values({
            id: uuid(),
            groupId: targetGroupId,
            wordId,
            addedAt: now,
          });
        } catch (err) {
          console.error('[batch-add-words] Group assignment failed for', wordText, err);
        }

        results.push({
          type: 'added',
          word: wordText,
          wordId,
          phonetic: ecdictEntry.phonetic ?? null,
          audioUrl: null,
          definition: ecdictEntry.translation,
          examples: finalExamples,
          tag: ecdictEntry.tag ?? null,
          collins: ecdictEntry.collins ?? null,
          group: groupName,
          message: `已添加 "${wordText}" 到词库（分组：${groupName}）`,
        });
        addedCount++;
      } catch (err: any) {
        // Handle race condition: word might have been inserted by another concurrent call
        if (err?.message?.includes('UNIQUE constraint')) {
          results.push({
            type: 'already-exists',
            word: wordText,
            message: `单词 "${wordText}" 已在词库中`,
          });
          skippedCount++;
        } else {
          console.error('[batch-add-words] Failed to add', wordText, err);
          results.push({
            type: 'error',
            word: wordText,
            message: `添加 "${wordText}" 失败: ${err?.message ?? '未知错误'}`,
          });
          errorCount++;
        }
      }
    }

    return {
      type: 'batch-added',
      total: normalized.length,
      addedCount,
      skippedCount,
      errorCount,
      results,
      group: groupName,
      message: `批量添加完成：成功 ${addedCount} 个，已存在 ${skippedCount} 个，失败 ${errorCount} 个`,
    };
  },
});

// Need to import inArray for the batch query
import { inArray } from 'drizzle-orm';
