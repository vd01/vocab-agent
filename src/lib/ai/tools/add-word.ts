import { defineTool } from './types';
import { z } from 'zod';
import { db } from '@/lib/db';
import { words, wordGroups, wordGroupMembers, reviews } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { lookupWord } from '@/lib/dictionary/lookup';
import { v4 as uuid } from 'uuid';

export const addWordTool = defineTool({
  description: '添加新单词到词库，并初始化 FSRS 复习卡片。只需提供 word，音标、释义、例句会自动从词典填充。也可手动覆盖任何字段。',
  inputSchema: z.object({
    word: z.string().describe('英语单词'),
    phonetic: z.string().optional().describe('音标，如 /ɪˈfemərəl/（留空自动填充）'),
    definition: z.string().optional().describe('中文释义（留空自动填充）'),
    examples: z.array(z.string()).optional().describe('例句列表（留空自动填充）'),
    source: z.string().optional().describe('来源：manual、reading、ecdict'),
    group: z.string().optional().describe('添加到指定分组（分组名），默认"日常"'),
    autoFill: z.boolean().optional().describe('是否从词典自动填充缺失字段，默认 true'),
  }),
  execute: async ({ word: wordText, phonetic, definition, examples, source, group, autoFill = true }) => {
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

    // Auto-fill from dictionary if needed
    let autoData: Awaited<ReturnType<typeof lookupWord>> = null;
    let autoFilled = false;

    if (autoFill && (!phonetic || !definition || !examples)) {
      autoData = await lookupWord(normalized);
    }

    // Merge: manual input takes priority, auto-fill fills gaps
    let finalPhonetic = phonetic ?? null;
    let finalAudioUrl: string | null = null;
    let finalDefinition = definition ?? null;
    let finalExamples = examples ?? null;
    let finalTag: string | null = null;
    let finalCollins: number | null = null;
    let finalBnc: number | null = null;
    let finalFrq: number | null = null;
    let finalExchange: string | null = null;

    if (autoData) {
      if (!finalPhonetic && autoData.phonetic) {
        finalPhonetic = autoData.phonetic;
        autoFilled = true;
      }
      if (autoData.audioUrl) {
        finalAudioUrl = autoData.audioUrl;
      }
      if (!finalDefinition && autoData.translation) {
        // Use Chinese translation from ECDICT
        finalDefinition = autoData.translation;
        autoFilled = true;
      }
      if (!finalExamples && autoData.definitions) {
        // Extract example sentences from API definitions
        const exs: string[] = [];
        for (const group of autoData.definitions) {
          for (const def of group.definitions) {
            if (def.example) exs.push(def.example);
          }
        }
        if (exs.length > 0) {
          finalExamples = exs;
          autoFilled = true;
        }
      }
      // Always fill metadata from ECDICT if available
      if (autoData.tag) finalTag = autoData.tag;
      if (autoData.collins) finalCollins = autoData.collins;
      if (autoData.bnc) finalBnc = autoData.bnc;
      if (autoData.frq) finalFrq = autoData.frq;
      if (autoData.exchange) finalExchange = autoData.exchange;
    }

    // Still no definition? Can't add without it
    if (!finalDefinition) {
      return {
        type: 'error',
        word: wordText,
        message: `无法添加 "${wordText}"：词典中未找到释义，请手动提供 definition 参数`,
      };
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
      source: source ?? (autoFilled ? 'ecdict' : 'manual'),
      tag: finalTag,
      collins: finalCollins,
      bnc: finalBnc,
      frq: finalFrq,
      exchange: finalExchange,
      createdAt: now,
    });

    // Initialize FSRS card — immediately available for review
    // (not queued behind daily new limit, since user explicitly added this word)
    const { createEmptyCard } = await import('ts-fsrs');
    const card = createEmptyCard();
    const reviewNow = new Date();
    await db.insert(reviews).values({
      id: uuid(),
      wordId,
      rating: 0,
      state: card.state as number,
      due: reviewNow,          // immediately available
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsed_days,
      scheduledDays: card.scheduled_days,
      reps: card.reps,
      lapses: card.lapses,
      lastReview: reviewNow,
      reviewedAt: reviewNow,
    });

    // Assign to group (default: "日常" — only use existing groups)
    const groupName = group?.trim() || '日常';
    let assignedGroup = groupName;
    try {
      const targetGroup = await db
        .select()
        .from(wordGroups)
        .where(eq(wordGroups.name, groupName))
        .limit(1);

      if (targetGroup.length > 0) {
        await db.insert(wordGroupMembers).values({
          id: uuid(),
          groupId: targetGroup[0].id,
          wordId,
          addedAt: new Date(),
        });
      } else {
        // Group doesn't exist — fall back to default group "日常"
        const defaultGroup = await db
          .select()
          .from(wordGroups)
          .where(eq(wordGroups.name, '日常'))
          .limit(1);
        if (defaultGroup.length > 0) {
          await db.insert(wordGroupMembers).values({
            id: uuid(),
            groupId: defaultGroup[0].id,
            wordId,
            addedAt: new Date(),
          });
          assignedGroup = '日常';
        }
      }
    } catch (err) {
      // Group assignment failure should not block word addition
      console.error('[add-word] Group assignment failed:', err);
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
});
