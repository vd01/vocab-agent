/**
 * WordNet 3.1 query module — optimized with sync preloading.
 *
 * Reads index.* and data.* files from wordnet-db at startup using
 * readFileSync (fast, ~300ms total for all 8 files), then serves
 * lookups from in-memory Maps.
 *
 * File format reference: https://wordnet.princeton.edu/documentation/wndb5wn
 */

import fs from 'fs';
import path from 'path';

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

let dictPath: string | null = null;

function getDictPath(): string {
  if (dictPath !== null) return dictPath;

  // Try wordnet-db's exported path first
  try {
    const mod = require('wordnet-db');
    if (mod && typeof mod.path === 'string' && fs.existsSync(mod.path)) {
      dictPath = mod.path;
      return mod.path;
    }
  } catch { /* wordnet-db not available */ }

  // Fallback: resolve via package.json location
  try {
    const pkgDir = path.dirname(require.resolve('wordnet-db/package.json'));
    const candidate = path.join(pkgDir, 'dict');
    if (fs.existsSync(candidate)) {
      dictPath = candidate;
      return dictPath;
    }
  } catch { /* require.resolve failed */ }

  throw new Error('wordnet-db dict directory not found');
}

// ── Internal types ───────────────────────────────────────────────────────

type IndexEntry = {
  lemma: string;
  pos: string;
  synsetOffsets: number[];
};

type DataEntry = {
  synsetOffset: number;
  pos: string;
  words: string[];
  gloss: string;
  pointers: Array<{ symbol: string; offset: number }>;
};

// ── POS mapping ──────────────────────────────────────────────────────────

const POS_SUFFIX: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  a: 'adj',
  r: 'adv',
};

// ── Sync file parsers ────────────────────────────────────────────────────

function parseIndexFileSync(pos: string): Map<string, IndexEntry> {
  const dp = getDictPath();
  const filePath = path.join(dp, `index.${POS_SUFFIX[pos]}`);
  const map = new Map<string, IndexEntry>();

  if (!fs.existsSync(filePath)) return map;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line || line[0] === ' ') continue;

    const parts = line.split(' ');
    if (parts.length < 4) continue;

    const lemma = parts[0].replace(/_/g, ' ');
    const synsetCnt = parseInt(parts[2], 10);
    if (synsetCnt === 0) continue;

    const pCnt = parseInt(parts[3], 10);
    const ptrSymbolEnd = 4 + pCnt;
    const offsetStart = ptrSymbolEnd + 2; // skip sense_cnt + tagsense_cnt

    const synsetOffsets: number[] = [];
    for (let i = offsetStart; i < Math.min(offsetStart + synsetCnt, parts.length); i++) {
      const offset = parseInt(parts[i], 10);
      if (!isNaN(offset)) synsetOffsets.push(offset);
    }

    map.set(lemma.toLowerCase(), { lemma, pos, synsetOffsets });
  }

  return map;
}

function parseDataFileSync(pos: string): Map<number, DataEntry> {
  const dp = getDictPath();
  const filePath = path.join(dp, `data.${POS_SUFFIX[pos]}`);
  const map = new Map<number, DataEntry>();

  if (!fs.existsSync(filePath)) return map;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line || line[0] === ' ') continue;

    const glossSplit = line.indexOf('|');
    const gloss = glossSplit >= 0 ? line.slice(glossSplit + 1).trim() : '';
    const dataPart = glossSplit >= 0 ? line.slice(0, glossSplit) : line;

    const parts = dataPart.trim().split(' ');
    if (parts.length < 6) continue;

    const synsetOffset = parseInt(parts[0], 10);
    const wCnt = parseInt(parts[3], 10);

    const words: string[] = [];
    for (let i = 0; i < wCnt; i++) {
      const wordIdx = 4 + i * 2;
      if (wordIdx < parts.length) {
        words.push(parts[wordIdx].replace(/_/g, ' '));
      }
    }

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

  return map;
}

// ── Lazy-loaded caches ───────────────────────────────────────────────────

const indexCache = new Map<string, Map<string, IndexEntry>>();
const dataCache = new Map<string, Map<number, DataEntry>>();

function getIndex(pos: string): Map<string, IndexEntry> {
  if (!indexCache.has(pos)) {
    indexCache.set(pos, parseIndexFileSync(pos));
  }
  return indexCache.get(pos)!;
}

function getData(pos: string): Map<number, DataEntry> {
  if (!dataCache.has(pos)) {
    dataCache.set(pos, parseDataFileSync(pos));
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
    const idx = getIndex(pos);
    const entry = idx.get(normalized);
    if (!entry) continue;

    const data = getData(pos);
    for (const offset of entry.synsetOffsets) {
      const dEntry = data.get(offset);
      if (!dEntry) continue;

      synsets.push({
        pos,
        definition: dEntry.gloss,
        lemmas: dEntry.words,
        examples: [],
      });

      for (const ptr of dEntry.pointers) {
        const target = data.get(ptr.offset);
        if (!target) continue;
        const targetLemmas = target.words.map((w) => w.toLowerCase());
        if (ptr.symbol === '@') {
          for (const l of targetLemmas) hypernymSet.add(l);
        } else if (ptr.symbol === '~') {
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
      getDictPath();
      return true;
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
