import { defineTool } from './types';
import { z } from 'zod';
import { db } from '../../db';
import { wordGroups, wordGroupMembers, words } from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

/**
 * Group management tool — allows the Teacher Agent to create, list, rename,
 * delete groups, and add/remove words from groups.
 */
export const groupManageTool = defineTool({
  description: '管理单词分组。支持创建、列出、重命名、删除分组，以及添加/移除分组中的单词。当用户提到"分组"、"创建分组"、"把xxx加到xxx分组"时调用。',
  inputSchema: z.object({
    action: z.enum(['list', 'create', 'rename', 'delete', 'add-word', 'remove-word']).describe('操作类型'),
    name: z.string().optional().describe('分组名称（create/rename 时使用）'),
    description: z.string().optional().describe('分组描述（create 时使用）'),
    groupId: z.string().optional().describe('分组 ID（rename/delete/add-word/remove-word 时使用）'),
    wordId: z.string().optional().describe('单词 ID（add-word/remove-word 时使用）'),
    word: z.string().optional().describe('单词文本（add-word/remove-word 时，如果不知道 wordId 可用 word 查找）'),
  }),
  execute: async ({ action, name, description: groupDesc, groupId, wordId, word: wordText }) => {
    switch (action) {
      case 'list': return listGroups();
      case 'create': return createGroup(name!, groupDesc);
      case 'rename': return renameGroup(groupId!, name!);
      case 'delete': return deleteGroup(groupId!);
      case 'add-word': return addWordToGroup(groupId!, wordId, wordText);
      case 'remove-word': return removeWordFromGroup(groupId!, wordId, wordText);
      default: return { type: 'error', message: `未知操作: ${action}` };
    }
  },
});

async function listGroups() {
  const groups = await db
    .select({
      id: wordGroups.id,
      name: wordGroups.name,
      description: wordGroups.description,
      isDefault: wordGroups.isDefault,
      wordCount: sql<number>`COUNT(${wordGroupMembers.id})`,
    })
    .from(wordGroups)
    .leftJoin(wordGroupMembers, eq(wordGroups.id, wordGroupMembers.groupId))
    .groupBy(wordGroups.id)
    .orderBy(wordGroups.isDefault, wordGroups.name);

  return {
    type: 'group-list',
    groups: groups.map(g => ({
      id: g.id,
      name: g.name,
      description: g.description,
      isDefault: g.isDefault === 1,
      wordCount: g.wordCount,
    })),
  };
}

async function createGroup(name: string, description?: string | null) {
  if (!name?.trim()) {
    return { type: 'error', message: '分组名称不能为空' };
  }

  const trimmedName = name.trim();

  const existing = await db
    .select({ id: wordGroups.id })
    .from(wordGroups)
    .where(eq(wordGroups.name, trimmedName))
    .limit(1);

  if (existing.length > 0) {
    return { type: 'error', message: `分组"${trimmedName}"已存在` };
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

  return {
    type: 'group-created',
    groupId,
    name: trimmedName,
    message: `已创建分组"${trimmedName}"`,
  };
}

async function renameGroup(groupId: string, newName: string) {
  if (!newName?.trim()) {
    return { type: 'error', message: '新名称不能为空' };
  }

  const trimmedName = newName.trim();

  const existing = await db
    .select()
    .from(wordGroups)
    .where(eq(wordGroups.id, groupId))
    .limit(1);

  if (existing.length === 0) {
    return { type: 'error', message: '分组不存在' };
  }

  if (existing[0].isDefault === 1) {
    return { type: 'error', message: '默认分组不能重命名' };
  }

  const duplicate = await db
    .select({ id: wordGroups.id })
    .from(wordGroups)
    .where(and(eq(wordGroups.name, trimmedName), sql`${wordGroups.id} != ${groupId}`))
    .limit(1);

  if (duplicate.length > 0) {
    return { type: 'error', message: `分组"${trimmedName}"已存在` };
  }

  await db
    .update(wordGroups)
    .set({ name: trimmedName })
    .where(eq(wordGroups.id, groupId));

  return {
    type: 'group-renamed',
    groupId,
    name: trimmedName,
    message: `已将分组重命名为"${trimmedName}"`,
  };
}

async function deleteGroup(groupId: string) {
  const existing = await db
    .select()
    .from(wordGroups)
    .where(eq(wordGroups.id, groupId))
    .limit(1);

  if (existing.length === 0) {
    return { type: 'error', message: '分组不存在' };
  }

  if (existing[0].isDefault === 1) {
    return { type: 'error', message: '默认分组不能删除' };
  }

  // Move words that only belong to this group to the default group
  const defaultGroup = await db
    .select({ id: wordGroups.id })
    .from(wordGroups)
    .where(eq(wordGroups.isDefault, 1))
    .limit(1);

  if (defaultGroup.length > 0) {
    const defaultGroupId = defaultGroup[0].id;

    // Find words that are ONLY in this group
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

    // Add sole-member words to default group
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
    await db
      .delete(wordGroupMembers)
      .where(eq(wordGroupMembers.groupId, groupId));
  }

  await db
    .delete(wordGroups)
    .where(eq(wordGroups.id, groupId));

  return {
    type: 'group-deleted',
    groupId,
    name: existing[0].name,
    message: `已删除分组"${existing[0].name}"`,
  };
}

async function addWordToGroup(groupId: string, wordId?: string | null, wordText?: string | null) {
  // Resolve wordId from word text if needed
  let resolvedWordId = wordId;
  let resolvedWord = wordText;

  if (!resolvedWordId && wordText) {
    const normalized = wordText.toLowerCase();
    const found = await db
      .select()
      .from(words)
      .where(eq(words.word, normalized))
      .limit(1);

    if (found.length === 0) {
      return { type: 'error', message: `单词"${wordText}"不在词库中，请先添加` };
    }
    resolvedWordId = found[0].id;
    resolvedWord = found[0].word;
  }

  if (!resolvedWordId) {
    return { type: 'error', message: '请提供 wordId 或 word 参数' };
  }

  // Verify group exists
  const group = await db
    .select()
    .from(wordGroups)
    .where(eq(wordGroups.id, groupId))
    .limit(1);

  if (group.length === 0) {
    return { type: 'error', message: '分组不存在' };
  }

  // Check if already a member
  const existing = await db
    .select()
    .from(wordGroupMembers)
    .where(and(eq(wordGroupMembers.groupId, groupId), eq(wordGroupMembers.wordId, resolvedWordId)))
    .limit(1);

  if (existing.length > 0) {
    // Get word name for message
    if (!resolvedWord) {
      const w = await db.select({ word: words.word }).from(words).where(eq(words.id, resolvedWordId)).limit(1);
      resolvedWord = w[0]?.word;
    }
    return {
      type: 'already-member',
      groupId,
      wordId: resolvedWordId,
      word: resolvedWord,
      groupName: group[0].name,
      message: `"${resolvedWord}"已在分组"${group[0].name}"中`,
    };
  }

  await db.insert(wordGroupMembers).values({
    id: uuid(),
    groupId,
    wordId: resolvedWordId,
    addedAt: new Date(),
  });

  if (!resolvedWord) {
    const w = await db.select({ word: words.word }).from(words).where(eq(words.id, resolvedWordId)).limit(1);
    resolvedWord = w[0]?.word;
  }

  return {
    type: 'word-added-to-group',
    groupId,
    wordId: resolvedWordId,
    word: resolvedWord,
    groupName: group[0].name,
    message: `已将"${resolvedWord}"添加到分组"${group[0].name}"`,
  };
}

async function removeWordFromGroup(groupId: string, wordId?: string | null, wordText?: string | null) {
  // Resolve wordId from word text if needed
  let resolvedWordId = wordId;
  let resolvedWord = wordText;

  if (!resolvedWordId && wordText) {
    const normalized = wordText.toLowerCase();
    const found = await db
      .select()
      .from(words)
      .where(eq(words.word, normalized))
      .limit(1);

    if (found.length === 0) {
      return { type: 'error', message: `单词"${wordText}"不在词库中` };
    }
    resolvedWordId = found[0].id;
    resolvedWord = found[0].word;
  }

  if (!resolvedWordId) {
    return { type: 'error', message: '请提供 wordId 或 word 参数' };
  }

  // Verify group exists
  const group = await db
    .select()
    .from(wordGroups)
    .where(eq(wordGroups.id, groupId))
    .limit(1);

  if (group.length === 0) {
    return { type: 'error', message: '分组不存在' };
  }

  // Prevent removing from default group if word has no other group
  if (group[0].isDefault === 1) {
    const otherMemberships = await db
      .select()
      .from(wordGroupMembers)
      .where(and(eq(wordGroupMembers.wordId, resolvedWordId), sql`${wordGroupMembers.groupId} != ${groupId}`))
      .limit(1);

    if (otherMemberships.length === 0) {
      return { type: 'error', message: '不能从默认分组移除：该单词没有其他分组，至少需要保留一个分组' };
    }
  }

  await db
    .delete(wordGroupMembers)
    .where(and(eq(wordGroupMembers.groupId, groupId), eq(wordGroupMembers.wordId, resolvedWordId)));

  if (!resolvedWord) {
    const w = await db.select({ word: words.word }).from(words).where(eq(words.id, resolvedWordId)).limit(1);
    resolvedWord = w[0]?.word;
  }

  return {
    type: 'word-removed-from-group',
    groupId,
    wordId: resolvedWordId,
    word: resolvedWord,
    groupName: group[0].name,
    message: `已将"${resolvedWord}"从分组"${group[0].name}"中移除`,
  };
}
