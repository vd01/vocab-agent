import { db } from '@/lib/db';
import { words, reviews, wordGroups, wordGroupMembers, pinnedWords } from '@/lib/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { lookupWord } from '@/lib/dictionary/lookup';
import { initializeCard } from '@/lib/fsrs/scheduler';
import { v4 as uuid } from 'uuid';

const MAX_PINS_PER_SIDE = 5;

/**
 * Quick Lookup Action API — handles add-to-library, pin, add-to-group actions
 * from the Tauri quick-lookup window.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { action, word } = body;

  if (!action || !word) {
    return Response.json({ type: 'error', message: '请提供 action 和 word 参数' }, { status: 400 });
  }

  const normalized = word.toLowerCase().trim();

  switch (action) {
    case 'add-to-library':
      return await addToLibrary(normalized, body.group);
    case 'add-and-pin':
      return await addAndPin(normalized, body.side ?? 'left', body.group);
    case 'pin':
      return await pinWord(normalized, body.side ?? 'left');
    case 'add-to-group':
      return await addToGroup(normalized, body.groupId, body.groupName);
    default:
      return Response.json({ type: 'error', message: `未知操作: ${action}` }, { status: 400 });
  }
}

async function addToLibrary(word: string, group?: string) {
  // Check if already exists
  const existing = await db.select().from(words).where(eq(words.word, word)).limit(1);
  if (existing.length > 0) {
    return Response.json({ type: 'already-exists', word, message: `单词 "${word}" 已在词库中` });
  }

  // Auto-fill from dictionary
  const autoData = await lookupWord(word);
  let finalPhonetic: string | null = null;
  let finalAudioUrl: string | null = null;
  let finalDefinition = '(暂无释义)';
  let finalExamples: string[] | null = null;
  let finalTag: string | null = null;
  let finalCollins: number | null = null;
  let finalBnc: number | null = null;
  let finalFrq: number | null = null;
  let finalExchange: string | null = null;

  if (autoData) {
    if (autoData.phonetic) finalPhonetic = autoData.phonetic;
    if (autoData.audioUrl) finalAudioUrl = autoData.audioUrl;
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

  if (!autoData && finalDefinition === '(暂无释义)') {
    return Response.json({ type: 'error', word, message: `词典中未找到 "${word}"` });
  }

  const wordId = uuid();
  const now = new Date();

  await db.insert(words).values({
    id: wordId,
    word,
    phonetic: finalPhonetic,
    audioUrl: finalAudioUrl,
    definition: finalDefinition,
    examples: finalExamples ? JSON.stringify(finalExamples) : null,
    source: autoData ? 'ecdict' : 'manual',
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
  const groupName = group?.trim() || '日常';
  let assignedGroup = groupName;
  try {
    const targetGroup = await db.select().from(wordGroups).where(eq(wordGroups.name, groupName)).limit(1);
    if (targetGroup.length > 0) {
      await db.insert(wordGroupMembers).values({
        id: uuid(),
        groupId: targetGroup[0].id,
        wordId,
        addedAt: now,
      });
    } else {
      // Fall back to default group
      const defaultGroup = await db.select().from(wordGroups).where(eq(wordGroups.name, '日常')).limit(1);
      if (defaultGroup.length > 0) {
        await db.insert(wordGroupMembers).values({
          id: uuid(),
          groupId: defaultGroup[0].id,
          wordId,
          addedAt: now,
        });
        assignedGroup = '日常';
      }
    }
  } catch (err) {
    console.error('[quick-lookup-action] Group assignment failed:', err);
    assignedGroup = '日常';
  }

  return Response.json({
    type: 'added',
    wordId,
    word,
    phonetic: finalPhonetic,
    audioUrl: finalAudioUrl,
    definition: finalDefinition,
    group: assignedGroup,
    message: `已添加 "${word}" 到词库（分组：${assignedGroup}）`,
  });
}

async function addAndPin(word: string, side: 'left' | 'right', group?: string) {
  // First add to library
  const addResult = await addToLibrary(word, group);
  const addData = await addResult.json();

  if (addData.type === 'error') {
    return Response.json(addData);
  }

  // If already exists, get the wordId
  const wordId = addData.wordId;
  if (!wordId) {
    // Word already existed, find it
    const existing = await db.select().from(words).where(eq(words.word, word)).limit(1);
    if (existing.length === 0) {
      return Response.json({ type: 'error', message: '单词未找到' });
    }
    return await pinWord(word, side);
  }

  // Now pin it
  const w = await db.select().from(words).where(eq(words.id, wordId)).limit(1);
  if (w.length === 0) {
    return Response.json({ type: 'error', message: '单词未找到' });
  }

  // Check if already pinned
  const existingPin = await db.select().from(pinnedWords).where(eq(pinnedWords.wordId, wordId)).limit(1);
  if (existingPin.length > 0) {
    return Response.json({
      type: 'added-and-pinned',
      wordId,
      word,
      side,
      message: `已添加 "${word}" 到词库，该单词已在置顶列表中`,
    });
  }

  // Check pin capacity
  const sidePins = await db
    .select()
    .from(pinnedWords)
    .where(sql`${pinnedWords.side} = ${side} AND ${pinnedWords.archivedAt} IS NULL`)
    .orderBy(asc(pinnedWords.position));

  let targetSide = side;
  if (sidePins.length >= MAX_PINS_PER_SIDE) {
    const otherSide = side === 'left' ? 'right' : 'left';
    const otherPins = await db
      .select()
      .from(pinnedWords)
      .where(sql`${pinnedWords.side} = ${otherSide} AND ${pinnedWords.archivedAt} IS NULL`)
      .orderBy(asc(pinnedWords.position));
    if (otherPins.length >= MAX_PINS_PER_SIDE) {
      return Response.json({
        type: 'added',
        wordId,
        word,
        message: `已添加 "${word}" 到词库，但置顶已满（每侧最多 ${MAX_PINS_PER_SIDE} 个）`,
      });
    }
    targetSide = otherSide;
  }

  const maxPos = sidePins.length > 0 ? Math.max(...sidePins.map(p => p.position)) : -1;
  await db.insert(pinnedWords).values({
    id: uuid(),
    wordId,
    word: w[0].word,
    phonetic: w[0].phonetic,
    audioUrl: w[0].audioUrl,
    definition: w[0].definition,
    position: maxPos + 1,
    side: targetSide,
    richContent: null,
    createdAt: new Date(),
  });

  return Response.json({
    type: 'added-and-pinned',
    wordId,
    word,
    side: targetSide,
    message: `已添加 "${word}" 到词库并置顶到${targetSide === 'left' ? '左' : '右'}侧栏`,
  });
}

async function pinWord(word: string, side: 'left' | 'right') {
  const existing = await db.select().from(words).where(eq(words.word, word)).limit(1);
  if (existing.length === 0) {
    return Response.json({ type: 'error', message: `单词 "${word}" 不在词库中，请先添加` });
  }

  const w = existing[0];

  // Check if already pinned
  const existingPin = await db.select().from(pinnedWords).where(eq(pinnedWords.wordId, w.id)).limit(1);
  if (existingPin.length > 0) {
    return Response.json({ type: 'already-pinned', word, message: `"${word}" 已在置顶列表中` });
  }

  // Check pin capacity
  const sidePins = await db
    .select()
    .from(pinnedWords)
    .where(sql`${pinnedWords.side} = ${side} AND ${pinnedWords.archivedAt} IS NULL`)
    .orderBy(asc(pinnedWords.position));

  let targetSide = side;
  if (sidePins.length >= MAX_PINS_PER_SIDE) {
    const otherSide = side === 'left' ? 'right' : 'left';
    const otherPins = await db
      .select()
      .from(pinnedWords)
      .where(sql`${pinnedWords.side} = ${otherSide} AND ${pinnedWords.archivedAt} IS NULL`)
      .orderBy(asc(pinnedWords.position));
    if (otherPins.length >= MAX_PINS_PER_SIDE) {
      return Response.json({
        type: 'full',
        word,
        message: `置顶已满（每侧最多 ${MAX_PINS_PER_SIDE} 个）`,
      });
    }
    targetSide = otherSide;
  }

  const maxPos = sidePins.length > 0 ? Math.max(...sidePins.map(p => p.position)) : -1;
  await db.insert(pinnedWords).values({
    id: uuid(),
    wordId: w.id,
    word: w.word,
    phonetic: w.phonetic,
    audioUrl: w.audioUrl,
    definition: w.definition,
    position: maxPos + 1,
    side: targetSide,
    richContent: null,
    createdAt: new Date(),
  });

  return Response.json({
    type: 'pinned',
    wordId: w.id,
    word,
    side: targetSide,
    message: `已将 "${word}" 置顶到${targetSide === 'left' ? '左' : '右'}侧栏`,
  });
}

async function addToGroup(word: string, groupId?: string, groupName?: string) {
  // Find the word
  const existing = await db.select().from(words).where(eq(words.word, word)).limit(1);
  if (existing.length === 0) {
    return Response.json({ type: 'error', message: `单词 "${word}" 不在词库中，请先添加` });
  }

  const wordId = existing[0].id;

  // If groupName provided and group doesn't exist, create it
  if (groupName && !groupId) {
    const existingGroup = await db.select().from(wordGroups).where(eq(wordGroups.name, groupName)).limit(1);
    if (existingGroup.length > 0) {
      groupId = existingGroup[0].id;
    } else {
      const newGroupId = uuid();
      await db.insert(wordGroups).values({
        id: newGroupId,
        name: groupName,
        description: null,
        isDefault: 0,
        createdAt: new Date(),
      });
      groupId = newGroupId;
    }
  }

  if (!groupId) {
    // Fall back to default group
    const defaultGroup = await db.select().from(wordGroups).where(eq(wordGroups.name, '日常')).limit(1);
    if (defaultGroup.length > 0) {
      groupId = defaultGroup[0].id;
    } else {
      return Response.json({ type: 'error', message: '未找到默认分组' });
    }
  }

  // Check if already in group
  const existingMember = await db
    .select()
    .from(wordGroupMembers)
    .where(sql`${wordGroupMembers.groupId} = ${groupId} AND ${wordGroupMembers.wordId} = ${wordId}`)
    .limit(1);

  if (existingMember.length > 0) {
    const group = await db.select({ name: wordGroups.name }).from(wordGroups).where(eq(wordGroups.id, groupId)).limit(1);
    return Response.json({
      type: 'already-in-group',
      word,
      groupName: group[0]?.name,
      message: `"${word}" 已在分组 "${group[0]?.name}" 中`,
    });
  }

  await db.insert(wordGroupMembers).values({
    id: uuid(),
    groupId,
    wordId,
    addedAt: new Date(),
  });

  const group = await db.select({ name: wordGroups.name }).from(wordGroups).where(eq(wordGroups.id, groupId)).limit(1);
  return Response.json({
    type: 'added-to-group',
    word,
    groupName: group[0]?.name,
    message: `已将 "${word}" 添加到分组 "${group[0]?.name}"`,
  });
}
