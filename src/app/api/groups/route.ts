import { db } from '@/lib/db';
import { wordGroups, wordGroupMembers, words } from '@/lib/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/groups — list all groups with word counts
export async function GET() {
  try {
    const groups = await db
      .select({
        id: wordGroups.id,
        name: wordGroups.name,
        description: wordGroups.description,
        isDefault: wordGroups.isDefault,
        createdAt: wordGroups.createdAt,
        wordCount: sql<number>`COUNT(${wordGroupMembers.id})`,
      })
      .from(wordGroups)
      .leftJoin(wordGroupMembers, eq(wordGroups.id, wordGroupMembers.groupId))
      .groupBy(wordGroups.id)
      .orderBy(wordGroups.isDefault, wordGroups.name);

    return NextResponse.json({ groups });
  } catch (error) {
    console.error('[Groups API] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
  }
}

// POST /api/groups — create a new group
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
    }

    const trimmedName = name.trim();

    // Check for duplicate name
    const existing = await db
      .select({ id: wordGroups.id })
      .from(wordGroups)
      .where(eq(wordGroups.name, trimmedName))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ error: `分组"${trimmedName}"已存在` }, { status: 409 });
    }

    const groupId = uuid();
    const now = new Date();

    await db.insert(wordGroups).values({
      id: groupId,
      name: trimmedName,
      description: description?.trim() || null,
      isDefault: 0,
      createdAt: now,
    });

    return NextResponse.json({
      type: 'created',
      groupId,
      name: trimmedName,
      message: `已创建分组"${trimmedName}"`,
    });
  } catch (error) {
    console.error('[Groups API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
  }
}

// PATCH /api/groups — rename a group
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { groupId, name } = body;

    if (!groupId || !name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'groupId and name are required' }, { status: 400 });
    }

    const trimmedName = name.trim();

    // Check if group exists
    const existing = await db
      .select()
      .from(wordGroups)
      .where(eq(wordGroups.id, groupId))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: `分组不存在` }, { status: 404 });
    }

    // Prevent renaming default group
    if (existing[0].isDefault === 1) {
      return NextResponse.json({ error: '默认分组不能重命名' }, { status: 400 });
    }

    // Check for duplicate name
    const duplicate = await db
      .select({ id: wordGroups.id })
      .from(wordGroups)
      .where(and(eq(wordGroups.name, trimmedName), sql`${wordGroups.id} != ${groupId}`))
      .limit(1);

    if (duplicate.length > 0) {
      return NextResponse.json({ error: `分组"${trimmedName}"已存在` }, { status: 409 });
    }

    await db
      .update(wordGroups)
      .set({ name: trimmedName })
      .where(eq(wordGroups.id, groupId));

    return NextResponse.json({
      type: 'renamed',
      groupId,
      name: trimmedName,
      message: `已将分组重命名为"${trimmedName}"`,
    });
  } catch (error) {
    console.error('[Groups API] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to rename group' }, { status: 500 });
  }
}

// DELETE /api/groups?id=xxx — delete a group
export async function DELETE(req: NextRequest) {
  try {
    const groupId = req.nextUrl.searchParams.get('id');

    if (!groupId) {
      return NextResponse.json({ error: 'Group ID is required' }, { status: 400 });
    }

    // Check if group exists
    const existing = await db
      .select()
      .from(wordGroups)
      .where(eq(wordGroups.id, groupId))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: '分组不存在' }, { status: 404 });
    }

    // Prevent deleting default group
    if (existing[0].isDefault === 1) {
      return NextResponse.json({ error: '默认分组不能删除' }, { status: 400 });
    }

    // Move words that only belong to this group to the default group
    const defaultGroup = await db
      .select({ id: wordGroups.id })
      .from(wordGroups)
      .where(eq(wordGroups.isDefault, 1))
      .limit(1);

    if (defaultGroup.length > 0) {
      const defaultGroupId = defaultGroup[0].id;

      // Find words that are ONLY in this group (no other group membership)
      const soleMemberWords = await db
        .select({ wordId: wordGroupMembers.wordId })
        .from(wordGroupMembers)
        .where(eq(wordGroupMembers.groupId, groupId))
        .groupBy(wordGroupMembers.wordId)
        .having(sql`COUNT(${wordGroupMembers.groupId}) = 1`);

      // Remove all memberships for this group
      await db
        .delete(wordGroupMembers)
        .where(eq(wordGroupMembers.groupId, groupId));

      // Add sole-member words to default group (idempotent via UNIQUE index)
      if (soleMemberWords.length > 0) {
        const now = new Date();
        for (const w of soleMemberWords) {
          await db.insert(wordGroupMembers).values({
            id: uuid(),
            groupId: defaultGroupId,
            wordId: w.wordId,
            addedAt: now,
          }).onConflictDoNothing();
        }
      }
    } else {
      // No default group — just remove memberships
      await db
        .delete(wordGroupMembers)
        .where(eq(wordGroupMembers.groupId, groupId));
    }

    // Delete the group
    await db
      .delete(wordGroups)
      .where(eq(wordGroups.id, groupId));

    return NextResponse.json({
      type: 'deleted',
      groupId,
      name: existing[0].name,
      message: `已删除分组"${existing[0].name}"`,
    });
  } catch (error) {
    console.error('[Groups API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
  }
}
