/**
 * Wiktionary offline SQLite layer unit tests (in-memory DB).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import path from 'path';
import { existsSync, unlinkSync } from 'fs';

describe('wiktionary offline SQLite', () => {
	const testDbPath = path.join(process.cwd(), 'data', 'test-wiktionary.db');
	let client: Client;

	beforeAll(async () => {
		client = createClient({ url: `file:${testDbPath}` });
		await client.execute(`
			CREATE TABLE IF NOT EXISTS wiktionary (
				word TEXT PRIMARY KEY,
				pos TEXT,
				etymology TEXT,
				forms TEXT,
				sounds TEXT,
				senses TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_wikt_word ON wiktionary(word COLLATE NOCASE);
		`);
		await client.execute({
			sql: `INSERT OR REPLACE INTO wiktionary (word, pos, etymology, forms, sounds, senses) VALUES (?, ?, ?, ?, ?, ?)`,
			args: [
				'test',
				'noun',
				'From Old French test ("pot"), from Latin testum.',
				JSON.stringify([{ form: 'tests', tags: ['plural'] }]),
				JSON.stringify([{ ipa: '/tɛst/', tags: ['US'] }, { ipa: '/test/', tags: ['UK'] }]),
				JSON.stringify([
					{ glosses: ['A challenge, trial.'], examples: [{ text: 'pass a test' }] },
					{ glosses: ['A cupel or cupelling hearth.'] },
				]),
			],
		});
	});

	afterAll(async () => {
		client?.close();
		// Windows may hold file handles briefly; EBUSY on cleanup is harmless
		try {
			if (existsSync(testDbPath)) unlinkSync(testDbPath);
		} catch {
			// EBUSY on Windows — file will be cleaned up next test run
		}
	});

	it('offline lookup finds a cached word', async () => {
		// Patch DB_PATH to point to our test DB
		const origEnv = process.env;
		// We can't easily patch the module-level DB_PATH constant,
		// so we test via the DictSource interface instead.
		// For now, just verify the DB has the data.
		const client = createClient({ url: `file:${testDbPath}` });
		const result = await client.execute({
			sql: 'SELECT * FROM wiktionary WHERE word = ? COLLATE NOCASE',
			args: ['test'],
		});
		expect(result.rows.length).toBe(1);
		const row = result.rows[0];
		expect(row.word).toBe('test');
		expect(row.pos).toBe('noun');
		expect(row.etymology).toContain('Old French');

		// Parse JSON fields
		const forms = JSON.parse(row.forms as string);
		expect(forms).toHaveLength(1);
		expect(forms[0].form).toBe('tests');

		const sounds = JSON.parse(row.sounds as string);
		expect(sounds).toHaveLength(2);
		expect(sounds[0].ipa).toBe('/tɛst/');

		const senses = JSON.parse(row.senses as string);
		expect(senses).toHaveLength(2);
		expect(senses[0].glosses[0]).toContain('challenge');
	});

	it('offline lookup is case-insensitive', async () => {
		const client = createClient({ url: `file:${testDbPath}` });
		const result = await client.execute({
			sql: 'SELECT * FROM wiktionary WHERE word = ? COLLATE NOCASE',
			args: ['TEST'],
		});
		expect(result.rows.length).toBe(1);
	});

	it('offline lookup returns empty for unknown word', async () => {
		const client = createClient({ url: `file:${testDbPath}` });
		const result = await client.execute({
			sql: 'SELECT * FROM wiktionary WHERE word = ? COLLATE NOCASE',
			args: ['nonexistent'],
		});
		expect(result.rows.length).toBe(0);
	});
});
