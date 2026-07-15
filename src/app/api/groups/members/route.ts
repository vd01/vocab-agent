import { db } from '@/lib/db';
import { wordGroupMembers, wordGroups, words } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/groups/members — add word to group
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { groupId, wordId } = body;

    if (!groupId || !wordId) {
      return NextResponse.json({ error: 'groupId and wordId are required' }, { status: 400 });
    }

    // Verify group exists
    const group = await db
      .select()
      .from(wordGroups)
      .where(eq(wordGroups.id, groupId))
      .limit(1);

    if (group.length === 0) {
      return NextResponse.json({ error: '分组不存在' }, { status: 404 });
    }

    // Verify word exists
    const word = await db
      .select()
      .from(words)
      .where(eq(words.id, wordId))
      .limit(1);

    if (word.length === 0) {
      return NextResponse.json({ error: '单词不存在' }, { status: 404 });
    }

    // Check if already a member (idempotent)
    const existing = await db
      .select()
      .from(wordGroupMembers)
      .where(and(eq(wordGroupMembers.groupId, groupId), eq(wordGroupMembers.wordId, wordId)))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({
        type: 'already-member',
        groupId,
        wordId,
        message: `"${word[0].word}"已在分组"${group[0].name}"中`,
      });
    }

    const member = {
      id: uuid(),
      groupId,
      wordId,
      addedAt: new Date(),
    };

    await db.insert(wordGroupMembers).values(member);

    return NextResponse.json({
      type: 'added',
      groupId,
      wordId,
      word: word[0].word,
      groupName: group[0].name,
      message: `已将"${word[0].word}"添加到分组"${group[0].name}"`,
    });
  } catch (error) {
    console.error('[Groups Members API] POST error:', error);
    return NextResponse.json({ error: 'Failed to add word to group' }, { status: 500 });
  }
}

// DELETE /api/groups/members?groupId=xxx&wordId=xxx — remove word from group
export async function DELETE(req: NextRequest) {
  try {
    const groupId = req.nextUrl.searchParams.get('groupId');
    const wordId = req.nextUrl.searchParams.get('wordId');

    if (!groupId || !wordId) {
      return NextResponse.json({ error: 'groupId and wordId are required' }, { status: 400 });
    }

    // Verify group exists
    const group = await db
      .select()
      .from(wordGroups)
      .where(eq(wordGroups.id, groupId))
      .limit(1);

    if (group.length === 0) {
      return NextResponse.json({ error: '分组不存在' }, { status: 404 });
    }

    // Verify word exists
    const word = await db
      .select()
      .from(words)
      .where(eq(words.id, wordId))
      .limit(1);

    if (word.length === 0) {
      return NextResponse.json({ error: '单词不存在' }, { status: 404 });
    }

    // Prevent removing from default group if word has no other group
    if (group[0].isDefault === 1) {
      const otherMemberships = await db
        .select()
        .from(wordGroupMembers)
        .where(and(eq(wordGroupMembers.wordId, wordId), sql`${wordGroupMembers.groupId} != ${groupId}`))
        .limit(1);

      if (otherMemberships.length === 0) {
        return NextResponse.json({
          error: '不能从默认分组移除：该单词没有其他分组，至少需要保留一个分组',
        }, { status: 400 });
      }
    }

    await db
      .delete(wordGroupMembers)
      .where(and(eq(wordGroupMembers.groupId, groupId), eq(wordGroupMembers.wordId, wordId)));

    return NextResponse.json({
      type: 'removed',
      groupId,
      wordId,
      word: word[0].word,
      groupName: group[0].name,
      message: `已将"${word[0].word}"从分组"${group[0].name}"中移除`,
    });
  } catch (error) {
    console.error('[Groups Members API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to remove word from group' }, { status: 500 });
  }
}
