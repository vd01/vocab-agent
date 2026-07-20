import { lookupWord } from "@/lib/dictionary/lookup";
import { NextRequest } from "next/server";

/**
 * Quick Lookup Enrich API - returns enriched dictionary data only.
 *
 * Called by the frontend after the fast ECDICT-only result is shown,
 * to get the full result with WordNet, FreeDict, Wiktionary, MDX data.
 * Only returns dictionary fields - no DB queries (those were already
 * fetched in the initial quick-lookup request).
 */
export async function GET(req: NextRequest) {
	const word = req.nextUrl.searchParams.get("word")?.trim().toLowerCase();
	if (!word) {
		return Response.json(
			{ type: "error", message: "请提供 word 参数" },
			{ status: 400 },
		);
	}

	const dictEntry = await lookupWord(word);

	return Response.json({
		word,
		phonetic: dictEntry?.phonetic ?? null,
		audioUrl: dictEntry?.audioUrl ?? null,
		translation: dictEntry?.translation ?? null,
		definitions: dictEntry?.definitions ?? [],
		collins: dictEntry?.collins ?? null,
		tag: dictEntry?.tag ?? null,
		bnc: dictEntry?.bnc ?? null,
		exchange: dictEntry?.exchange ?? null,
		synonyms: dictEntry?.synonyms ?? [],
		// Per-source enriched fields
		mdxEntries: dictEntry?.mdxEntries ?? [],
		mdxSenses: dictEntry?.mdxSenses ?? [],
		synsets: dictEntry?.synsets ?? [],
		etymology: dictEntry?.etymology ?? null,
		ipa: dictEntry?.ipa ?? [],
		forms: dictEntry?.forms ?? [],
		semanticRelations: dictEntry?.semanticRelations ?? null,
		source: dictEntry?.source ?? null,
	});
}
