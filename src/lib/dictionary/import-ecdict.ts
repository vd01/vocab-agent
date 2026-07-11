/**
 * Import ECDICT CSV data into data/ecdict.db (SQLite via @libsql/client).
 *
 * Usage: npx tsx src/lib/dictionary/import-ecdict.ts
 *
 * Reads ECDICT/ecdict.csv (77万+ entries), batch inserts into ecdict table.
 * Expected runtime: 2-5 minutes depending on disk speed.
 */

import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const CSV_PATH = path.join(process.cwd(), 'ECDICT', 'ecdict.csv');
const DB_PATH = path.join(process.cwd(), 'data', 'ecdict.db');

const BATCH_SIZE = 2000;

interface CsvRow {
  word: string;
  phonetic: string;
  definition: string;
  translation: string;
  pos: string;
  collins: string;
  oxford: string;
  tag: string;
  bnc: string;
  frq: string;
  exchange: string;
  detail: string;
  audio: string;
}

/**
 * Parse a CSV line respecting quoted fields (ECDICT uses standard CSV quoting).
 */
function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);

  // ECDICT CSV has 13 columns
  if (fields.length < 13) return null;

  return fields;
}

async function importEcdict() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`ECDICT CSV not found at ${CSV_PATH}`);
    console.error('Please clone ECDICT repo first: git clone https://github.com/skywind3000/ECDICT.git');
    process.exit(1);
  }

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const client = createClient({ url: `file:${DB_PATH}` });

  // Create table (drop if exists for clean import)
  console.log('Creating ecdict table...');
  await client.execute('DROP TABLE IF EXISTS ecdict');
  await client.execute(`
    CREATE TABLE ecdict (
      word TEXT PRIMARY KEY,
      phonetic TEXT,
      definition TEXT,
      translation TEXT,
      pos TEXT,
      collins INTEGER,
      oxford INTEGER,
      tag TEXT,
      bnc INTEGER,
      frq INTEGER,
      exchange TEXT
    )
  `);

  console.log('Reading CSV file...');
  const fileStream = fs.createReadStream(CSV_PATH, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let totalRows = 0;
  let batch: any[][] = [];
  let skippedShort = 0;

  // Prepare insert statement
  const insertSql = `INSERT INTO ecdict (word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const startTime = Date.now();

  for await (const line of rl) {
    // Skip header
    if (totalRows === 0 && line.startsWith('word,')) {
      totalRows++;
      continue;
    }

    const fields = parseCsvLine(line);
    if (!fields) {
      skippedShort++;
      continue;
    }

    const word = fields[0]?.trim();
    if (!word) {
      skippedShort++;
      continue;
    }

    // Parse numeric fields
    const collins = fields[5] ? parseInt(fields[5]) : null;
    const oxford = fields[6] ? parseInt(fields[6]) : null;
    const bnc = fields[8] ? parseInt(fields[8]) : null;
    const frq = fields[9] ? parseInt(fields[9]) : null;

    batch.push([
      word,
      fields[1] || null,     // phonetic
      fields[2] || null,     // definition
      fields[3] || null,     // translation
      fields[4] || null,     // pos
      collins,
      oxford,
      fields[7] || null,     // tag
      bnc,
      frq,
      fields[10] || null,    // exchange
    ]);

    if (batch.length >= BATCH_SIZE) {
      await executeBatch(client, insertSql, batch);
      totalRows += batch.length;
      batch = [];

      // Progress
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r  Imported ${totalRows.toLocaleString()} rows (${elapsed}s)`);
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await executeBatch(client, insertSql, batch);
    totalRows += batch.length;
  }

  // Create index
  console.log('\nCreating index...');
  await client.execute('CREATE INDEX idx_ecdict_word ON ecdict(word)');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nImport complete: ${totalRows.toLocaleString()} rows in ${elapsed}s`);
  if (skippedShort > 0) {
    console.log(`  Skipped ${skippedShort} malformed rows`);
  }

  process.exit(0);
}

async function executeBatch(client: any, sql: string, batch: any[][]) {
  // Use transaction for batch inserts
  await client.execute('BEGIN TRANSACTION');
  try {
    for (const params of batch) {
      await client.execute({ sql, args: params });
    }
    await client.execute('COMMIT');
  } catch (err) {
    await client.execute('ROLLBACK');
    // Try inserting one by one to skip duplicates
    for (const params of batch) {
      try {
        await client.execute({ sql, args: params });
      } catch {
        // Skip duplicate/invalid rows
      }
    }
  }
}

importEcdict().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
