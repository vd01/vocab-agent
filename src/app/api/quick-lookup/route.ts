import { db } from "@/lib/db";
import {
	words,
	reviews,
	wordGroups,
	wordGroupMembers,
	pinnedWords,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { lookupWordFast } from "@/lib/dictionary/lookup";
import { NextRequest } from "next/server";

/**
 * Quick Lookup API — optimized for the Tauri quick-lookup window.
 *
 * Uses lookupWordFast() which returns offline data (ECDICT + WordNet + MDX)
 * immediately. Online sources (FreeDict + Wiktionary) run in the background
 * to warm the cache for future lookups, but the response is sent immediately
 * with offline data — no waiting for network.
 */
export async function GET(req: NextRequest) {
	const word = req.nextUrl.searchParams.get("word")?.trim().toLowerCase();
	if (!word) {
		return Response.json(
			{ type: "error", message: "请提供 word 参数" },
			{ status: 400 },
		);
	}

	// Run DB queries and dictionary lookup in parallel
	const [dbData, [dictEntry]] = await Promise.all([
		fetchLibraryData(word),
		lookupWordFast(word),
	]);

	// Online enrichment runs in background (lookupWordFast returns it as
	// the second tuple element) — we ignore it here and let it warm the
	// cache. Next lookup for the same word will hit the enriched cache.

	// Build response
	const fsrsStateLabel =
		dbData.fsrsState !== null
			? (["New", "Learning", "Review", "Relearning"][dbData.fsrsState] ?? "Unknown")
			: null;

	const actions: string[] = [];
	if (!dbData.inLibrary) {
		actions.push("add-to-library");
		actions.push("add-and-pin");
	} else {
		if (!dbData.isPinned) {
			actions.push("pin");
		}
		actions.push("add-to-group");
	}

	return Response.json({
		type: dbData.inLibrary ? "in-library" : "not-in-library",
		word,
		inLibrary: dbData.inLibrary,
		wordId: dbData.wordId,
		groups: dbData.groups,
		isPinned: dbData.isPinned,
		fsrsState: dbData.fsrsState,
		fsrsStateLabel,
		fsrsDue: dbData.fsrsDue,
		phonetic: dictEntry?.phonetic ?? null,
		audioUrl: dictEntry?.audioUrl ?? null,
		translation: dictEntry?.translation ?? null,
		definitions: dictEntry?.definitions ?? [],
		collins: dictEntry?.collins ?? null,
		tag: dictEntry?.tag ?? null,
		bnc: dictEntry?.bnc ?? null,
		exchange: dictEntry?.exchange ?? null,
		synonyms: dictEntry?.synonyms ?? [],
		actions,
		allGroups: dbData.allGroups,
	});
}

/** Fetch all library-related data in parallel */
async function fetchLibraryData(word: string) {
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

		// Run FSRS, groups, and pin checks in parallel
		const [reviewRows, groupRows, pinRows] = await Promise.all([
			db.select().from(reviews).where(eq(reviews.wordId, wordId)).limit(1),
			db
				.select({ name: wordGroups.name, id: wordGroups.id })
				.from(wordGroupMembers)
				.innerJoin(wordGroups, eq(wordGroupMembers.groupId, wordGroups.id))
				.where(eq(wordGroupMembers.wordId, wordId)),
			db
				.select({ id: pinnedWords.id })
				.from(pinnedWords)
				.where(eq(pinnedWords.wordId, wordId))
				.limit(1),
		]);

		if (reviewRows.length > 0) {
			fsrsState = reviewRows[0].state as number;
			fsrsDue = reviewRows[0].due.toISOString();
		}
		groups = groupRows.map((g) => g.name);
		isPinned = pinRows.length > 0;
	}

	// Also fetch all groups for the selector (independent of word lookup)
	const allGroupsRows = await db
		.select({ id: wordGroups.id, name: wordGroups.name })
		.from(wordGroups)
		.orderBy(wordGroups.isDefault, wordGroups.name);

	return {
		inLibrary,
		wordId,
		fsrsState,
		fsrsDue,
		groups,
		isPinned,
		allGroups: allGroupsRows.map((g) => ({ id: g.id, name: g.name })),
	};
}
