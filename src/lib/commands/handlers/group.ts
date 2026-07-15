/**
 * /group command — manage word groups.
 *
 * Usage:
 *   /group                     — list all groups with word counts
 *   /group <name>              — switch active group (returned in result for frontend)
 *   /group create <name>       — create a new group
 *   /group delete <name>       — delete a group (words move to "日常")
 *   /group rename <old> <new>  — rename a group
 *   /group add <word> <group>  — add word to group
 *   /group remove <word> <group> — remove word from group
 */

import { db } from '@/lib/db';
import { wordGroups, wordGroupMembers, words } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import type { CommandHandler, CommandResult } from '../executor';

export const groupHandler: CommandHandler = {
  name: 'group',
  description: '管理单词分组',
  usage: '/group [create|delete|rename|add|remove] [参数]',

  async execute(args: string[]): Promise<CommandResult> {
    const subCommand = args[0]?.toLowerCase();

    // No sub-command or group name → list groups
    if (!subCommand) {
      return listGroups();
    }

    // If it's a known sub-command, dispatch
    switch (subCommand) {
      case 'create': return createGroup(args[1]);
      case 'delete': return deleteGroup(args[1]);
      case 'rename': return renameGroup(args[1], args[2]);
      case 'add': return addWordToGroup(args[1], args[2]);
      case 'remove': return removeWordFromGroup(args[1], args[2]);
      default:
        // Treat as group name for switching
        return switchGroup(subCommand);
    }
  },
};

async function listGroups(): Promise<CommandResult> {
  const groups = await db
    .select({
      id: wordGroups.id,
      name: wordGroups.name,
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
      isDefault: g.isDefault === 1,
      wordCount: g.wordCount,
    })),
  };
}

async function switchGroup(name: string): Promise<CommandResult> {
  if (!name) return listGroups();

  const group = await db
    .select()
    .from(wordGroups)
    .where(eq(wordGroups.name, name))
    .limit(1);

  if (group.length === 0) {
    return { type: 'error', message: `分组"${name}"不存在。使用 /group create ${name} 创建` };
  }

  return {
    type: 'group-switched',
    groupId: group[0].id,
    groupName: group[0].name,
    message: `已切换到分组"${group[0].name}"`,
  };
}

async function createGroup(name?: string): Promise<CommandResult> {
  if (!name?.trim()) {
    return { type: 'error', message: '请提供分组名称，如 /group create 四级' };
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
  await db.insert(wordGroups).values({
    id: groupId,
    name: trimmedName,
    isDefault: 0,
    createdAt: new Date(),
  });

  return {
    type: 'group-created',
    groupId,
    name: trimmedName,
    message: `已创建分组"${trimmedName}"`,
  };
}

async function deleteGroup(name?: string): Promise<CommandResult> {
  if (!name?.trim()) {
    return { type: 'error', message: '请提供分组名称，如 /group delete 四级' };
  }

  const trimmedName = name.trim();

  const existing = await db
    .select()
    .from(wordGroups)
    .where(eq(wordGroups.name, trimmedName))
    .limit(1);

  if (existing.length === 0) {
    return { type: 'error', message: `分组"${trimmedName}"不存在` };
  }

  if (existing[0].isDefault === 1) {
    return { type: 'error', message: '默认分组不能删除' };
  }

  const groupId = existing[0].id;

  // Move words that only belong to this group to the default group
  const defaultGroup = await db
    .select({ id: wordGroups.id })
    .from(wordGroups)
    .where(eq(wordGroups.isDefault, 1))
    .limit(1);

  if (defaultGroup.length > 0) {
    const defaultGroupId = defaultGroup[0].id;

    const soleMemberWords = await db
      .select({ wordId: wordGroupMembers.wordId })
      .from(wordGroupMembers)
      .where(eq(wordGroupMembers.groupId, groupId))
      .groupBy(wordGroupMembers.wordId)
      .having(sql`COUNT(${wordGroupMembers.groupId}) = 1`);

    await db.delete(wordGroupMembers).where(eq(wordGroupMembers.groupId, groupId));

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
    await db.delete(wordGroupMembers).where(eq(wordGroupMembers.groupId, groupId));
  }

  await db.delete(wordGroups).where(eq(wordGroups.id, groupId));

  return {
    type: 'group-deleted',
    name: trimmedName,
    message: `已删除分组"${trimmedName}"`,
  };
}

async function renameGroup(oldName?: string, newName?: string): Promise<CommandResult> {
  if (!oldName?.trim() || !newName?.trim()) {
    return { type: 'error', message: '请提供旧名称和新名称，如 /group rename 四级 CET4' };
  }

  const trimmedOld = oldName.trim();
  const trimmedNew = newName.trim();

  const existing = await db
    .select()
    .from(wordGroups)
    .where(eq(wordGroups.name, trimmedOld))
    .limit(1);

  if (existing.length === 0) {
    return { type: 'error', message: `分组"${trimmedOld}"不存在` };
  }

  if (existing[0].isDefault === 1) {
    return { type: 'error', message: '默认分组不能重命名' };
  }

  const duplicate = await db
    .select({ id: wordGroups.id })
    .from(wordGroups)
    .where(eq(wordGroups.name, trimmedNew))
    .limit(1);

  if (duplicate.length > 0) {
    return { type: 'error', message: `分组"${trimmedNew}"已存在` };
  }

  await db
    .update(wordGroups)
    .set({ name: trimmedNew })
    .where(eq(wordGroups.id, existing[0].id));

  return {
    type: 'group-renamed',
    name: trimmedNew,
    message: `已将分组"${trimmedOld}"重命名为"${trimmedNew}"`,
  };
}

async function addWordToGroup(wordText?: string, groupName?: string): Promise<CommandResult> {
  if (!wordText?.trim() || !groupName?.trim()) {
    return { type: 'error', message: '请提供单词和分组名，如 /group add abandon 四级' };
  }

  const normalized = wordText.toLowerCase().trim();
  const trimmedGroup = groupName.trim();

  // Find word
  const word = await db
    .select()
    .from(words)
    .where(eq(words.word, normalized))
    .limit(1);

  if (word.length === 0) {
    return { type: 'error', message: `单词"${wordText}"不在词库中，请先添加` };
  }

  // Find group
  const group = await db
    .select()
    .from(wordGroups)
    .where(eq(wordGroups.name, trimmedGroup))
    .limit(1);

  if (group.length === 0) {
    return { type: 'error', message: `分组"${trimmedGroup}"不存在。使用 /group create ${trimmedGroup} 创建` };
  }

  // Check if already a member
  const existing = await db
    .select()
    .from(wordGroupMembers)
    .where(and(eq(wordGroupMembers.groupId, group[0].id), eq(wordGroupMembers.wordId, word[0].id)))
    .limit(1);

  if (existing.length > 0) {
    return { type: 'already-member', message: `"${word[0].word}"已在分组"${trimmedGroup}"中` };
  }

  await db.insert(wordGroupMembers).values({
    id: uuid(),
    groupId: group[0].id,
    wordId: word[0].id,
    addedAt: new Date(),
  });

  return {
    type: 'word-added-to-group',
    word: word[0].word,
    groupName: trimmedGroup,
    message: `已将"${word[0].word}"添加到分组"${trimmedGroup}"`,
  };
}

async function removeWordFromGroup(wordText?: string, groupName?: string): Promise<CommandResult> {
  if (!wordText?.trim() || !groupName?.trim()) {
    return { type: 'error', message: '请提供单词和分组名，如 /group remove abandon 四级' };
  }

  const normalized = wordText.toLowerCase().trim();
  const trimmedGroup = groupName.trim();

  // Find word
  const word = await db
    .select()
    .from(words)
    .where(eq(words.word, normalized))
    .limit(1);

  if (word.length === 0) {
    return { type: 'error', message: `单词"${wordText}"不在词库中` };
  }

  // Find group
  const group = await db
    .select()
    .from(wordGroups)
    .where(eq(wordGroups.name, trimmedGroup))
    .limit(1);

  if (group.length === 0) {
    return { type: 'error', message: `分组"${trimmedGroup}"不存在` };
  }

  // Prevent removing from default group if word has no other group is the only one
  if (group[0].isDefault === 1) {
    const otherMemberships = await db
      .select()
      .from(wordGroupMembers)
      .where(and(eq(wordGroupMembers.wordId, word[0].id), sql`${wordGroupMembers.groupId} != ${group[0].id}`))
      .limit(1);

    if (otherMemberships.length === 0) {
      return { type: 'error', message: '不能从默认分组移除：该单词没有其他分组' };
    }
  }

  await db
    .delete(wordGroupMembers)
    .where(and(eq(wordGroupMembers.groupId, group[0].id), eq(wordGroupMembers.wordId, word[0].id)));

  return {
    type: 'word-removed-from-group',
    word: word[0].word,
    groupName: trimmedGroup,
    message: `已将"${word[0].word}"从分组"${trimmedGroup}"中移除`,
  };
}
