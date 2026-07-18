import { db } from "../../db";
import { wordGroups, wordGroupMembers } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import type { Extractor } from "./registry";

/**
 * Group distribution extractor — provides word counts per group.
 * Used by the World State to inform the Teacher Agent about group structure.
 */
export const groupDistributionExtractor: Extractor = {
	name: "group-distribution",
	description: "Word counts per group",

	async extract(): Promise<Record<string, unknown>> {
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
			groups: groups.map((g) => ({
				id: g.id,
				name: g.name,
				isDefault: g.isDefault === 1,
				wordCount: g.wordCount,
			})),
		};
	},
};
