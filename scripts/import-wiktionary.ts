/**
 * Wiktionary offline subset importer.
 *
 * Usage: npx tsx scripts/import-wiktionary.ts [--input data/simple-extract.jsonl.gz] [--limit 20000]
 *
 * Streams a Kaikki JSONL .gz file, filters English language entries,
 * extracts a minimal subset of fields, and writes to data/wiktionary.db.
 *
 * Resume-safe: writes progress to data/wiktionary-import.progress.
 */

import { createClient } from '@libsql/client';
import { createGunzip } from 'zlib';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import * as readline from 'readline';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'wiktionary.db');
const PROGRESS_PATH = path.join(DATA_DIR, 'wiktionary-import.progress');

// ── CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
	const idx = args.indexOf(name);
	return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const INPUT = arg('--input') ?? path.join(DATA_DIR, 'simple-extract.jsonl.gz');
const LIMIT = parseInt(arg('--limit') ?? '20000', 10);

// ── Types ────────────────────────────────────────────────────────────────

interface KaikkiEntry {
	word?: string;
	lang?: string;
	lang_code?: string;
	pos?: string;
	etymology_text?: string;
	forms?: Array<{ form?: string; tags?: string[] }>;
	sounds?: Array<{ ipa?: string; audio?: string; tags?: string[] }>;
	senses?: Array<{
		glosses?: string[];
		examples?: Array<{ text?: string }>;
		tags?: string[];
	}>;
}

// ── SQLite schema ────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wiktionary (
  word TEXT PRIMARY KEY,
  pos TEXT,
  etymology TEXT,
  forms TEXT,
  sounds TEXT,
  senses TEXT
);
CREATE INDEX IF NOT EXISTS idx_wikt_word ON wiktionary(word COLLATE NOCASE);
`;

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
	if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

	if (!existsSync(INPUT)) {
		console.error(`Input file not found: ${INPUT}`);
		console.error('Download from: https://kaikki.org/dictionary/rawdata.html');
		console.error('Recommended for testing: simple-extract.jsonl.gz (4.4 MB)');
		process.exit(1);
	}

	// Set up SQLite
	const client = createClient({ url: `file:${DB_PATH}` });
	await client.execute(SCHEMA);
	console.log(`Database ready: ${DB_PATH}`);

	// Read resume progress
	let linesProcessed = 0;
	let byteOffset = 0;
	if (existsSync(PROGRESS_PATH)) {
		const progress = JSON.parse(readFileSync(PROGRESS_PATH, 'utf-8'));
		linesProcessed = progress.linesProcessed ?? 0;
		byteOffset = progress.byteOffset ?? 0;
		console.log(`Resuming from byte ${byteOffset}, ${linesProcessed} lines already processed`);
	}

	// Stream the .gz file
	const fileSize = statSync(INPUT).size;
	console.log(`Input: ${INPUT} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
	console.log(`Limit: ${LIMIT.toLocaleString()} entries`);

	const stream = createReadStream(INPUT, { start: byteOffset });
	const gunzip = createGunzip();
	const rl = readline.createInterface({ input: stream.pipe(gunzip), crlfDelay: Infinity });

	let batch: Array<{
		word: string;
		pos: string;
		etymology: string | null;
		forms: string | null;
		sounds: string | null;
		senses: string | null;
	}> = [];
	let imported = 0;
	let skipped = 0;
	let bytesRead = byteOffset;
	const startTime = Date.now();

	// Save progress periodically
	const saveProgress = (lines: number, bytes: number) => {
		writeFileSync(
			PROGRESS_PATH,
			JSON.stringify({ linesProcessed: linesProcessed + lines, byteOffset: byteOffset + bytes }),
		);
	};

	// Flush batch to DB
	const flushBatch = async () => {
		if (batch.length === 0) return;
		const stmt = `INSERT OR REPLACE INTO wiktionary (word, pos, etymology, forms, sounds, senses) VALUES (?, ?, ?, ?, ?, ?)`;
		for (const row of batch) {
			await client.execute({
				sql: stmt,
				args: [row.word, row.pos, row.etymology, row.forms, row.sounds, row.senses],
			});
		}
		batch = [];
	};

	for await (const line of rl) {
		bytesRead += Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline
		linesProcessed++;

		if (imported >= LIMIT) break;

		// Fast pre-filter: check for "lang" or "English" in the line before full parse
		if (!line.includes('"lang"') || !line.includes('"English"')) {
			skipped++;
			continue;
		}

		let entry: KaikkiEntry;
		try {
			entry = JSON.parse(line);
		} catch {
			skipped++;
			continue;
		}

		// Only English language entries
		if (entry.lang !== 'English' && entry.lang_code !== 'en') {
			skipped++;
			continue;
		}

		// Normalize word
		const word = (entry.word ?? '').trim().toLowerCase();
		if (!word || word.length < 2) {
			skipped++;
			continue;
		}

		// Extract fields
		const etymology = entry.etymology_text ?? null;
		const forms = entry.forms ? JSON.stringify(entry.forms) : null;
		const sounds = entry.sounds ? JSON.stringify(entry.sounds) : null;
		const senses = entry.senses ? JSON.stringify(entry.senses) : null;

		batch.push({ word, pos: entry.pos ?? '', etymology, forms, sounds, senses });
		imported++;

		// Flush every 500 entries
		if (batch.length >= 500) {
			await flushBatch();
			const elapsed = (Date.now() - startTime) / 1000;
			const rate = Math.round(imported / elapsed);
			console.log(
				`  Imported ${imported.toLocaleString()} / ${LIMIT.toLocaleString()} (${skipped.toLocaleString()} skipped) — ${rate}/s`,
			);
		}

		// Save progress every 5K lines
		if (linesProcessed % 5000 === 0) {
			saveProgress(0, bytesRead - byteOffset);
		}
	}

	// Final flush
	await flushBatch();

	// Cleanup progress file on success
	if (existsSync(PROGRESS_PATH)) unlinkSync(PROGRESS_PATH);

	const elapsed = (Date.now() - startTime) / 1000;
	console.log(`\nDone! Imported ${imported.toLocaleString()} entries in ${elapsed.toFixed(1)}s`);
	console.log(`Skipped ${skipped.toLocaleString()} non-English or unparseable lines`);
	console.log(`Database: ${DB_PATH}`);
}

main().catch((err) => {
	console.error('Import failed:', err);
	process.exit(1);
});
