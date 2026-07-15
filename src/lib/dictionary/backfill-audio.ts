/**
 * Backfill audioUrl for existing words in the library.
 *
 * Iterates words where audio_url IS NULL, looks each up via the Free
 * Dictionary API (dictionaryapi.dev), and stores the real pronunciation MP3
 * URL (preferring the US variant). After backfilling words, syncs the
 * denormalized audio_url into pinned_words.
 *
 * Usage: npx tsx src/lib/dictionary/backfill-audio.ts
 *
 * Safe to re-run: only touches rows with a null audio_url. Words the API
 * has no audio for are left null (the UI falls back to TTS for those).
 */

import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import { freeDictLookup } from './free-dict-api';

function resolveDbPath(): string {
  if (process.env.VOCAB_DATA_DIR) {
    return path.join(process.env.VOCAB_DATA_DIR, 'vocab.db');
  }
  return path.join(process.cwd(), 'data', 'vocab.db');
}

/** Prefer US pronunciation, then UK, then any. Mirrors lookup.ts pickPreferredAudio. */
function pickPreferredAudio(audios: string[]): string | null {
  if (audios.length === 0) return null;
  return audios.find(a => a.includes('-us'))
    ?? audios.find(a => a.includes('-uk'))
    ?? audios[0];
}

async function backfill() {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}`);
    console.error('Run `npm run db:migrate` first.');
    process.exit(1);
  }

  const client = createClient({ url: `file:${dbPath}` });

  const rows = await client.execute(
    `SELECT id, word FROM words WHERE audio_url IS NULL ORDER BY word`
  );
  const words = rows.rows as unknown as Array<{ id: string; word: string }>;
  console.log(`Found ${words.length} words without audio_url`);

  if (words.length === 0) {
    console.log('Nothing to backfill.');
    process.exit(0);
  }

  let updated = 0;
  let noAudio = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < words.length; i++) {
    const { id, word } = words[i];
    try {
      const entry = await freeDictLookup(word);
      const audios = (entry?.phonetics ?? [])
        .map(p => p.audio)
        .filter((a): a is string => !!a && a.length > 2);
      const audioUrl = pickPreferredAudio(audios);

      if (audioUrl) {
        await client.execute({
          sql: `UPDATE words SET audio_url = ? WHERE id = ?`,
          args: [audioUrl, id],
        });
        updated++;
      } else {
        noAudio++;
      }
    } catch {
      failed++;
    }

    // Polite delay to avoid hammering the free API
    await new Promise(r => setTimeout(r, 150));

    if ((i + 1) % 25 === 0 || i === words.length - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(
        `\r  Processed ${i + 1}/${words.length} | updated ${updated} | no-audio ${noAudio} | failed ${failed} (${elapsed}s)`
      );
    }
  }

  // Sync denormalized audio_url into pinned_words from words
  console.log('\nSyncing pinned_words.audio_url from words...');
  const syncRes = await client.execute(
    `UPDATE pinned_words
     SET audio_url = (SELECT audio_url FROM words WHERE words.id = pinned_words.word_id)
     WHERE audio_url IS NULL`
  );
  console.log(`  Synced ${syncRes.rowsAffected} pinned_words rows`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nBackfill complete in ${elapsed}s: ${updated} updated, ${noAudio} without audio, ${failed} failed`);
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
