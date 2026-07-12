import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pinnedWords, words } from '@/lib/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { lookupWord } from '@/lib/dictionary/lookup';

const MAX_PINS_PER_SIDE = 5;

export async function GET() {
  try {
    const pins = await db
      .select()
      .from(pinnedWords)
      .orderBy(asc(pinnedWords.side), asc(pinnedWords.position));

    return NextResponse.json({ pins });
  } catch (err) {
    console.error('[Pins API] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch pins' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { wordId, side = 'left' } = body;

    if (!wordId) {
      return NextResponse.json({ error: 'wordId is required' }, { status: 400 });
    }

    if (side !== 'left' && side !== 'right') {
      return NextResponse.json({ error: 'side must be "left" or "right"' }, { status: 400 });
    }

    const existingWord = await db
      .select()
      .from(words)
      .where(eq(words.id, wordId))
      .limit(1);

    if (existingWord.length === 0) {
      return NextResponse.json({ error: 'Word not found' }, { status: 404 });
    }

    const alreadyPinned = await db
      .select()
      .from(pinnedWords)
      .where(eq(pinnedWords.wordId, wordId))
      .limit(1);

    if (alreadyPinned.length > 0) {
      return NextResponse.json({ error: 'Word already pinned', pin: alreadyPinned[0] }, { status: 409 });
    }

    const sidePins = await db
      .select()
      .from(pinnedWords)
      .where(eq(pinnedWords.side, side))
      .orderBy(asc(pinnedWords.position));

    if (sidePins.length >= MAX_PINS_PER_SIDE) {
      return NextResponse.json({
        error: `该侧已满（最多 ${MAX_PINS_PER_SIDE} 个），请先移除旧的置顶单词`,
        maxPerSide: MAX_PINS_PER_SIDE,
        currentCount: sidePins.length,
      }, { status: 409 });
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

    const pin = await db
      .select()
      .from(pinnedWords)
      .where(eq(pinnedWords.id, pinId))
      .limit(1);

    return NextResponse.json({ pin: pin[0] }, { status: 201 });
  } catch (err) {
    console.error('[Pins API] POST error:', err);
    return NextResponse.json({ error: 'Failed to pin word' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const pinId = searchParams.get('id');

    if (!pinId) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    const existing = await db
      .select()
      .from(pinnedWords)
      .where(eq(pinnedWords.id, pinId))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Pin not found' }, { status: 404 });
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

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[Pins API] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to unpin word' }, { status: 500 });
  }
}
