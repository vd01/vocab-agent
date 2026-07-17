import { defineTool } from './types';
import { z } from 'zod';
import { db } from '@/lib/db';
import { words, wordGroups, wordGroupMembers } from '@/lib/db/schema';
import { eq, inArray, notInArray, and, like, sql } from 'drizzle-orm';
import { ecdictBatchLookup } from '@/lib/dictionary/ecdict';
import { v4 as uuid } from 'uuid';

/**
 * Initialize an FSRS review card that is immediately available for review.
 */
async function initializeCardImmediate(wordId: string): Promise<void> {
	const { createEmptyCard } = await import('ts-fsrs');
	const card = createEmptyCard();
	const now = new Date();

	const { reviews } = await import('@/lib/db/schema');
	await db.insert(reviews).values({
		id: uuid(),
		wordId,
		rating: 0,
		state: card.state as number,
		due: now,
		stability: card.stability,
		difficulty: card.difficulty,
		elapsedDays: card.elapsed_days,
		scheduledDays: card.scheduled_days,
		reps: card.reps,
		lapses: card.lapses,
		lastReview: now,
		reviewedAt: now,
	});
}

/**
 * Query ECDICT for words matching a tag, sorted by frequency.
 * Returns the word list (not yet imported).
 */
async function queryEcdictByTag(
	tag: string,
	limit: number,
	excludeLowerTags: boolean,
): Promise<{ word: string; phonetic: string | null; tag: string | null; collins: number | null; frq: number | null }[]> {
	const { createClient } = await import('@libsql/client');
	const ecdictClient = createClient({ url: `file:${process.cwd()}/data/ecdict.db` });

	// Build WHERE clause
	let whereClause = `tag LIKE '%' || ? || '%'`;
	const args: any[] = [tag];

	if (excludeLowerTags) {
		// For cet6, exclude words that also have cet4
		// For gre, exclude words that also have cet4 or cet6
		// For toefl, exclude words that also have cet4 or cet6
		const lowerTagMap: Record<string, string[]> = {
			cet6: ['cet4'],
			gre: ['cet4', 'cet6'],
			toefl: ['cet4', 'cet6'],
			ielts: ['cet4', 'cet6'],
		};
		const lowerTags = lowerTagMap[tag.toLowerCase()];
		if (lowerTags) {
			for (const lt of lowerTags) {
				whereClause += ` AND tag NOT LIKE '%' || ? || '%'`;
				args.push(lt);
			}
		}
	}

	// Sort by frq (contemporary corpus frequency, lower = more frequent), fallback to bnc
	const query = `SELECT word, phonetic, tag, collins, frq FROM ecdict WHERE ${whereClause} AND translation IS NOT NULL AND translation != '' ORDER BY CASE WHEN frq IS NOT NULL AND frq > 0 THEN frq ELSE 999999 END ASC, CASE WHEN bnc IS NOT NULL AND bnc > 0 THEN bnc ELSE 999999 END ASC LIMIT ?`;
	args.push(limit);

	const result = await ecdictClient.execute({ sql: query, args });
	return result.rows.map((row) => ({
		word: row.word as string,
		phonetic: (row.phonetic as string) || null,
		tag: (row.tag as string) || null,
		collins: row.collins != null ? Number(row.collins) : null,
		frq: row.frq != null ? Number(row.frq) : null,
	}));
}

export const importByTagTool = defineTool({
	description:
		'从 ECDICT 词典中按考试标签筛选高频单词并批量导入到词库。支持 cet4、cet6、gre、toefl、ielts 等标签，按词频排序选取最高频的词。可排除低级别词（如导入六级时排除四级词）。',
	inputSchema: z.object({
		tag: z
			.string()
			.describe(
				'考试标签，如 cet4、cet6、gre、toefl、ielts。对应大学英语四级、六级、GRE、托福、雅思',
			),
		limit: z
			.number()
			.optional()
			.describe('导入单词数量，默认 100，最大 500'),
		group: z
			.string()
			.optional()
			.describe('导入到指定分组（分组名），必须为已存在的分组，默认"日常"'),
		excludeLowerTags: z
			.boolean()
			.optional()
			.describe(
				'是否排除低级别标签的词。如 tag=cet6 时排除同时标记 cet4 的词；tag=gre 时排除同时标记 cet4/cet6 的词。默认 true',
			),
		preview: z
			.boolean()
			.optional()
			.describe(
				'仅预览不导入，返回匹配的单词列表供用户确认。默认 false',
			),
	}),
	execute: async ({ tag, limit = 100, group, excludeLowerTags = true, preview = false }) => {
		const normalizedTag = tag.toLowerCase().trim();
		const effectiveLimit = Math.min(Math.max(limit, 1), 500);

		// 1. Query ECDICT for words matching the tag
		let ecdictWords: Awaited<ReturnType<typeof queryEcdictByTag>>;
		try {
			ecdictWords = await queryEcdictByTag(normalizedTag, effectiveLimit, excludeLowerTags);
		} catch (err: any) {
			return {
				type: 'error',
				message: `查询 ECDICT 失败：${err?.message ?? '未知错误'}。请确认 ECDICT 数据库已导入（npm run import-ecdict）`,
			};
		}

		if (ecdictWords.length === 0) {
			return {
				type: 'error',
				message: `未找到标签为 "${normalizedTag}" 的单词。支持的标签：cet4、cet6、gre、toefl、ielts`,
			};
		}

		// Preview mode — just return the list
		if (preview) {
			return {
				type: 'preview',
				tag: normalizedTag,
				excludeLowerTags,
				totalFound: ecdictWords.length,
				words: ecdictWords.map((w) => ({
					word: w.word,
					phonetic: w.phonetic,
					tag: w.tag,
					collins: w.collins,
					frq: w.frq,
				})),
				message: `预览：找到 ${ecdictWords.length} 个标签为 "${normalizedTag}" 的高频词${excludeLowerTags ? '（已排除低级别词）' : ''}。设置 preview=false 执行导入。`,
			};
		}

		// 2. Resolve group
		const groupName = group?.trim() || '日常';
		const targetGroup = await db
			.select()
			.from(wordGroups)
			.where(eq(wordGroups.name, groupName))
			.limit(1);

		if (targetGroup.length === 0) {
			return {
				type: 'error',
				message: `分组 "${groupName}" 不存在。请先创建分组，或使用已有分组。可用分组可通过 group-manage 工具查看。`,
			};
		}
		const targetGroupId = targetGroup[0].id;

		// 3. Check which words already exist in user's vocab
		// Normalize to lowercase for consistent matching
		const wordTexts = ecdictWords.map((w) => w.word.toLowerCase());
		const existingSet = new Set<string>();

		const CHUNK = 200;
		for (let i = 0; i < wordTexts.length; i += CHUNK) {
			const chunk = wordTexts.slice(i, i + CHUNK);
			const existing = await db
				.select({ word: words.word })
				.from(words)
				.where(inArray(words.word, chunk));
			for (const row of existing) {
				existingSet.add(row.word);
			}
		}

		// 4. Batch lookup in ECDICT for full data
		// Use original ECDICT casing for lookup, then normalize to lowercase for storage
		const ecdictOriginalWords = ecdictWords.map((w) => w.word);
		const unknownOriginals = ecdictOriginalWords.filter((_, idx) => !existingSet.has(wordTexts[idx]));
		const ecdictResults = await ecdictBatchLookup(unknownOriginals);

		// 5. Import each word
		const now = new Date();
		let addedCount = 0;
		let skippedCount = 0;
		let errorCount = 0;
		const addedWords: string[] = [];
		const skippedWords: string[] = [];
		const failedWords: string[] = [];

		for (let idx = 0; idx < ecdictWords.length; idx++) {
			const ecdictWordInfo = ecdictWords[idx];
			const wordText = wordTexts[idx]; // lowercase

			if (existingSet.has(wordText)) {
				skippedCount++;
				skippedWords.push(wordText);
				continue;
			}

			// Lookup by original ECDICT casing (e.g. "Islam") and lowercase
			const ecdictEntry = ecdictResults.get(ecdictWordInfo.word) || ecdictResults.get(wordText);
			if (!ecdictEntry || !ecdictEntry.translation) {
				errorCount++;
				failedWords.push(wordText);
				continue;
			}

			const wordId = uuid();

			try {
				await db.insert(words).values({
					id: wordId,
					word: wordText,
					phonetic: ecdictEntry.phonetic ?? null,
					audioUrl: null,
					definition: ecdictEntry.translation,
					examples: null,
					source: 'ecdict',
					tag: ecdictEntry.tag ?? null,
					collins: ecdictEntry.collins ?? null,
					bnc: ecdictEntry.bnc ?? null,
					frq: ecdictEntry.frq ?? null,
					exchange: ecdictEntry.exchange ?? null,
					createdAt: now,
				});

				await initializeCardImmediate(wordId);

				// Assign to group
				try {
					await db.insert(wordGroupMembers).values({
						id: uuid(),
						groupId: targetGroupId,
						wordId,
						addedAt: now,
					});
				} catch (err) {
					console.error('[import-by-tag] Group assignment failed for', wordText, err);
				}

				addedCount++;
				addedWords.push(wordText);
			} catch (err: any) {
				if (err?.message?.includes('UNIQUE constraint')) {
					skippedCount++;
					skippedWords.push(wordText);
				} else {
					console.error('[import-by-tag] Failed to add', wordText, err);
					errorCount++;
					failedWords.push(wordText);
				}
			}
		}

		return {
			type: 'imported',
			tag: normalizedTag,
			excludeLowerTags,
			group: groupName,
			totalFound: ecdictWords.length,
			addedCount,
			skippedCount,
			errorCount,
			addedWords: addedWords.slice(0, 50), // Limit to first 50 for display
			skippedWords: skippedWords.slice(0, 20),
			failedWords: failedWords.slice(0, 20),
			message: `导入完成：标签 "${normalizedTag}"，共找到 ${ecdictWords.length} 个词，成功导入 ${addedCount} 个到"${groupName}"分组，已存在 ${skippedCount} 个，失败 ${errorCount} 个`,
		};
	},
});
