import { db, client } from "../../db";
import { words } from "../../db/schema";
import { sql, desc } from "drizzle-orm";
import type { Extractor } from "./registry";

export const vocabSummaryExtractor: Extractor = {
	name: "vocab-summary",
	description: "词库总量、连续学习天数、最近添加的单词",
	async extract() {
		const [totalResult, recentResult, streakResult] = await Promise.all([
			db.select({ count: sql<number>`count(*)` }).from(words),
			db
				.select({ word: words.word })
				.from(words)
				.orderBy(desc(words.createdAt))
				.limit(5),
			computeStreakDays(),
		]);

		return {
			totalWords: Number(totalResult[0]?.count ?? 0),
			streakDays: streakResult,
			recentWords: recentResult.map((r) => r.word),
		};
	},
};

/**
 * Compute consecutive learning streak days.
 * Uses raw SQL via libsql client to avoid Drizzle timestamp issues.
 */
async function computeStreakDays(): Promise<number> {
	const rows = await client.execute({
		sql: `
      SELECT date(reviewed_at, 'unixepoch') as review_date
      FROM reviews
      WHERE rating > 0
      GROUP BY date(reviewed_at, 'unixepoch')
      ORDER BY review_date DESC
    `,
		args: [],
	});

	const dates = rows.rows.map((r) => (r as any).review_date as string);
	if (dates.length === 0) return 0;

	const today = new Date();
	const todayStr = today.toISOString().slice(0, 10);
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	const yesterdayStr = yesterday.toISOString().slice(0, 10);

	if (dates[0] !== todayStr && dates[0] !== yesterdayStr) return 0;

	let streak = 1;
	for (let i = 1; i < dates.length; i++) {
		const prev = new Date(dates[i - 1]);
		const curr = new Date(dates[i]);
		const diffDays = Math.round(
			(prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24),
		);
		if (diffDays === 1) {
			streak++;
		} else {
			break;
		}
	}

	return streak;
}
