import { db } from '@/lib/db';
import { words, reviews, wordGroups, wordGroupMembers, pinnedWords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { lookupWord } from '@/lib/dictionary/lookup';
import { NextRequest } from 'next/server';

/**
 * Quick Lookup API — optimized for the Tauri quick-lookup window.
 * Returns word definition, library status, learning status, and available actions
 * in a single request.
 */
export async function GET(req: NextRequest) {
  const word = req.nextUrl.searchParams.get('word')?.trim().toLowerCase();
  if (!word) {
    return Response.json({ type: 'error', message: '请提供 word 参数' }, { status: 400 });
  }

  // 1. Check user's vocab library
  const result = await db
    .select()
    .from(words)
    .where(eq(words.word, word))
    .limit(1);

  let inLibrary = false;
  let wordId: string | null = null;
  let fsrsState: number | null = null;
  let fsrsDue: string | null = null;
  let groups: string[] = [];
  let isPinned = false;

  if (result.length > 0) {
    inLibrary = true;
    wordId = result[0].id;
    const w = result[0];

    // Get FSRS state
    const reviewRows = await db
      .select()
      .from(reviews)
      .where(eq(reviews.wordId, w.id))
      .limit(1);

    if (reviewRows.length > 0) {
      const r = reviewRows[0];
      fsrsState = r.state as number;
      fsrsDue = r.due.toISOString();
    }

    // Get group memberships
    const groupRows = await db
      .select({ name: wordGroups.name, id: wordGroups.id })
      .from(wordGroupMembers)
      .innerJoin(wordGroups, eq(wordGroupMembers.groupId, wordGroups.id))
      .where(eq(wordGroupMembers.wordId, w.id));
    groups = groupRows.map(g => g.name);

    // Check if pinned
    const pinRows = await db
      .select({ id: pinnedWords.id })
      .from(pinnedWords)
      .where(eq(pinnedWords.wordId, w.id))
      .limit(1);
    isPinned = pinRows.length > 0;
  }

  // 2. Get dictionary data
  const dictEntry = await lookupWord(word);

  // 3. Build response
  const fsrsStateLabel = fsrsState !== null
    ? ['New', 'Learning', 'Review', 'Relearning'][fsrsState] ?? 'Unknown'
    : null;

  // 4. Determine available actions
  const actions: string[] = [];
  if (!inLibrary) {
    actions.push('add-to-library');           // 入库
    actions.push('add-and-pin');              // 入库并置顶
  } else {
    if (!isPinned) {
      actions.push('pin');                     // 置顶
    }
    actions.push('add-to-group');              // 加入分组或新建分组
  }

  // 5. Get all groups for the group selector
  const allGroups = await db
    .select({ id: wordGroups.id, name: wordGroups.name })
    .from(wordGroups)
    .orderBy(wordGroups.isDefault, wordGroups.name);

  return Response.json({
    type: inLibrary ? 'in-library' : 'not-in-library',
    word,
    // Library info
    inLibrary,
    wordId,
    groups,
    isPinned,
    // FSRS info
    fsrsState,
    fsrsStateLabel,
    fsrsDue,
    // Dictionary data
    phonetic: dictEntry?.phonetic ?? null,
    audioUrl: dictEntry?.audioUrl ?? null,
    translation: dictEntry?.translation ?? null,
    definitions: dictEntry?.definitions ?? [],
    collins: dictEntry?.collins ?? null,
    tag: dictEntry?.tag ?? null,
    bnc: dictEntry?.bnc ?? null,
    exchange: dictEntry?.exchange ?? null,
    synonyms: dictEntry?.synonyms ?? [],
    // Available actions
    actions,
    // All groups for selector
    allGroups: allGroups.map(g => ({ id: g.id, name: g.name })),
  });
}
