/**
 * Minimal WordNet 3.1 query module.
 *
 * Reads index.* and data.* files from wordnet-db to provide synsets,
 * lemmas, hypernyms, and hyponyms — no external runtime dependency besides wordnet-db.
 *
 * File format reference: https://wordnet.princeton.edu/documentation/wndb5wn
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

// ── Types ────────────────────────────────────────────────────────────────

export interface WordNetSynset {
	pos: 'n' | 'v' | 'a' | 'r'; // noun, verb, adjective, adverb
	definition: string;
	lemmas: string[];
	examples: string[];
}

export interface WordNetSemanticRelations {
	hypernyms: string[]; // broader terms (e.g., "dog" → "animal")
	hyponyms: string[]; // narrower terms (e.g., "animal" → "dog")
}

// ── WNDB path ────────────────────────────────────────────────────────────

function getDictPath(): string {
	// Use require.resolve to get the real path, avoiding symlink/junction issues
	const pkgDir = path.dirname(require.resolve('wordnet-db/package.json'));
	return path.join(pkgDir, 'dict');
}

// ── File readers ─────────────────────────────────────────────────────────

/** POS tag → index/data filename suffix */
const POS_SUFFIX: Record<string, string> = {
	n: 'noun',
	v: 'verb',
	a: 'adj',
	r: 'adv',
};

type IndexEntry = {
	lemma: string;
	pos: string;
	synsetOffsets: number[];
};

type DataEntry = {
	synsetOffset: number;
	pos: string;
	words: string[];
	gloss: string; // definition + examples
	pointers: Array<{ symbol: string; offset: number }>;
};

/** Parse an index file into a Map<lemma, IndexEntry> */
async function parseIndexFile(pos: string): Promise<Map<string, IndexEntry>> {
	const dictPath = getDictPath();
	const suffix = POS_SUFFIX[pos];
	const filePath = path.join(dictPath, `index.${suffix}`);

	const map = new Map<string, IndexEntry>();
	if (!fs.existsSync(filePath)) return map;

	const stream = fs.createReadStream(filePath, 'utf-8');
	const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

	for await (const line of rl) {
		// Skip comment lines (start with space)
		if (!line || line[0] === ' ') continue;

		const parts = line.split(' ');
		if (parts.length < 4) continue;

		const lemma = parts[0].replace(/_/g, ' ');
		const synsetCnt = parseInt(parts[2], 10);
		if (synsetCnt === 0) continue;

		// synset offsets start after ptr_symbol section + sense_cnt + tagsense_cnt
		// The format is: lemma pos synset_cnt p_cnt [ptr_symbol...] sense_cnt tagsense_cnt [synset_offset...]
		const pCnt = parseInt(parts[3], 10);
		// ptr_symbol section: p_cnt entries
		const ptrSymbolEnd = 4 + pCnt;
		const senseCnt = parseInt(parts[ptrSymbolEnd], 10);
		const tagsenseCnt = parseInt(parts[ptrSymbolEnd + 1], 10);
		const offsetStart = ptrSymbolEnd + 2;

		const synsetOffsets: number[] = [];
		for (let i = offsetStart; i < Math.min(offsetStart + synsetCnt, parts.length); i++) {
			const offset = parseInt(parts[i], 10);
			if (!isNaN(offset)) synsetOffsets.push(offset);
		}

		map.set(lemma.toLowerCase(), { lemma, pos, synsetOffsets });
	}

	stream.destroy();
	return map;
}

/** Parse a data file into a Map<offset, DataEntry> */
async function parseDataFile(pos: string): Promise<Map<number, DataEntry>> {
	const dictPath = getDictPath();
	const suffix = POS_SUFFIX[pos];
	const filePath = path.join(dictPath, `data.${suffix}`);

	const map = new Map<number, DataEntry>();
	if (!fs.existsSync(filePath)) return map;

	const stream = fs.createReadStream(filePath, 'utf-8');
	const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

	for await (const line of rl) {
		if (!line || line[0] === ' ') continue;

		// Format: synset_offset lex_filenum ss_type w_cnt [word lex_id...] ptr_cnt [ptr_symbol synset_offset pos source/target...] | gloss
		const glossSplit = line.indexOf('|');
		const gloss = glossSplit >= 0 ? line.slice(glossSplit + 1).trim() : '';
		const dataPart = glossSplit >= 0 ? line.slice(0, glossSplit) : line;

		const parts = dataPart.trim().split(' ');
		if (parts.length < 6) continue;

		const synsetOffset = parseInt(parts[0], 10);
		const wCnt = parseInt(parts[3], 10);

		// words: w_cnt pairs of (word, lex_id)
		const words: string[] = [];
		for (let i = 0; i < wCnt; i++) {
			const wordIdx = 4 + i * 2;
			if (wordIdx < parts.length) {
				words.push(parts[wordIdx].replace(/_/g, ' '));
			}
		}

		// pointer section
		const ptrStart = 4 + wCnt * 2;
		const ptrCnt = parseInt(parts[ptrStart], 10);
		const pointers: Array<{ symbol: string; offset: number }> = [];
		for (let i = 0; i < ptrCnt; i++) {
			const ptrIdx = ptrStart + 1 + i * 4;
			if (ptrIdx + 3 < parts.length) {
				pointers.push({
					symbol: parts[ptrIdx],
					offset: parseInt(parts[ptrIdx + 1], 10),
				});
			}
		}

		map.set(synsetOffset, { synsetOffset, pos, words, gloss, pointers });
	}

	stream.destroy();
	return map;
}

// ── Caches ───────────────────────────────────────────────────────────────

const indexCache = new Map<string, Map<string, IndexEntry>>();
const dataCache = new Map<string, Map<number, DataEntry>>();

async function getIndex(pos: string): Promise<Map<string, IndexEntry>> {
	if (!indexCache.has(pos)) {
		indexCache.set(pos, await parseIndexFile(pos));
	}
	return indexCache.get(pos)!;
}

async function getData(pos: string): Promise<Map<number, DataEntry>> {
	if (!dataCache.has(pos)) {
		dataCache.set(pos, await parseDataFile(pos));
	}
	return dataCache.get(pos)!;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Look up synsets for a word. Returns synsets across all POS categories.
 */
export async function wordnetLookup(
	word: string,
): Promise<{ synsets: WordNetSynset[]; relations: WordNetSemanticRelations } | null> {
	const normalized = word.toLowerCase().replace(/\s+/g, '_');
	const synsets: WordNetSynset[] = [];
	const hypernymSet = new Set<string>();
	const hyponymSet = new Set<string>();

	for (const pos of ['n', 'v', 'a', 'r'] as const) {
		const idx = await getIndex(pos);
		const entry = idx.get(normalized);
		if (!entry) continue;

		const data = await getData(pos);
		for (const offset of entry.synsetOffsets) {
			const dEntry = data.get(offset);
			if (!dEntry) continue;

			synsets.push({
				pos,
				definition: dEntry.gloss,
				lemmas: dEntry.words,
				examples: [], // WordNet 3.1 gloss includes examples after "; " separator
			});

			// Collect semantic relations
			for (const ptr of dEntry.pointers) {
				const target = data.get(ptr.offset);
				if (!target) continue;
				const targetLemmas = target.words.map((w) => w.toLowerCase());
				if (ptr.symbol === '@') {
					// Hypernym
					for (const l of targetLemmas) hypernymSet.add(l);
				} else if (ptr.symbol === '~') {
					// Hyponym
					for (const l of targetLemmas) hyponymSet.add(l);
				}
			}
		}
	}

	if (synsets.length === 0) return null;

	// Extract examples from glosses
	for (const s of synsets) {
		const semiIdx = s.definition.indexOf(';');
		if (semiIdx >= 0) {
			const examplePart = s.definition.slice(semiIdx + 1).trim();
			if (examplePart.startsWith('"') || examplePart.startsWith("'")) {
				s.examples = [examplePart.replace(/^["']|["']$/g, '')];
				s.definition = s.definition.slice(0, semiIdx).trim();
			}
		}
	}

	return {
		synsets,
		relations: {
			hypernyms: [...hypernymSet].slice(0, 30),
			hyponyms: [...hyponymSet].slice(0, 30),
		},
	};
}

// ── Source adapter ────────────────────────────────────────────────────────

import type { DictSource } from './types';

/**
 * DictSource adapter for WordNet.
 * Provides synsets and semantic relations — purely additive data.
 */
export const wordnetSource: DictSource = {
	name: 'wordnet',
	available: async () => {
		try {
			const mod = require('wordnet-db');
			return mod && typeof mod.path === 'string';
		} catch {
			return false;
		}
	},
	lookup: async (word: string) => {
		const result = await wordnetLookup(word);
		if (!result) return null;
		return {
			word,
			synsets: result.synsets,
			semanticRelations: result.relations,
			source: 'wordnet',
		};
	},
};
