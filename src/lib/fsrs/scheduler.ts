export type { Card } from 'ts-fsrs';
export { Rating, State } from 'ts-fsrs';

import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs';
import { db, client } from '@/lib/db';
import { reviews, words, pinnedWords } from '@/lib/db/schema';
import { eq, and, lte, desc, sql, gt } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const engine = fsrs();

// ── Timestamp helper ────────────────────────────────────────────────────
// Drizzle's `timestamp` mode stores seconds since epoch in SQLite integer columns.
// When passing a JS Date as a query parameter, Drizzle does NOT auto-convert it
// through the column's mapToDriverValue — the raw Date gets serialized as
// milliseconds by the libsql client. This causes comparisons to fail silently
// (seconds in DB vs milliseconds in params).
// Fix: always convert Date → seconds explicitly before using in queries.

/** Convert a Date to Unix seconds (matching Drizzle's `timestamp` mode storage) */
function toUnixSec(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** Convert Unix seconds to a Date */
function fromUnixSec(sec: number): Date {
  return new Date(sec * 1000);
}

export interface DueWord {
  wordId: string;
  word: string;
  phonetic: string | null;
  definition: string;
  examples: string | null;
  pinned: boolean;
  card: Card;
}

/**
 * Get words due for review today.
 *
 * Each word appears at most once — uses the latest review record per word
 * to determine if it's due. This avoids duplicate entries because the
 * reviews table is append-only (every processReview inserts a new row).
 *
 * Uses raw SQL to avoid Drizzle timestamp deserialization issues
 * with subquery joins.
 */
export async function getDueWords(limit = 20): Promise<DueWord[]> {
  const nowSec = toUnixSec(new Date());

  // Exclude words actually reviewed in the last 5 minutes to prevent
  // the same word appearing again in the same review session.
  // (FSRS Learning state has very short intervals, so a word
  // rated "Good" can become due again in seconds.)
  // However, initialization records (rating=0) are NOT filtered —
  // newly added words should be immediately available for review.
  const fiveMinAgoSec = nowSec - 300;

  const result = await client.execute({
    sql: `
      SELECT
        r.id, r.word_id, r.state, r.due, r.stability, r.difficulty,
        r.elapsed_days, r.scheduled_days, r.reps, r.lapses,
        w.id as w_id, w.word as w_word, w.phonetic as w_phonetic,
        w.definition as w_definition, w.examples as w_examples,
        CASE WHEN pw.id IS NOT NULL THEN 1 ELSE 0 END as w_pinned
      FROM reviews r
      INNER JOIN (
        SELECT word_id, max(reviewed_at) as max_reviewed_at
        FROM reviews
        GROUP BY word_id
      ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
      INNER JOIN words w ON r.word_id = w.id
      LEFT JOIN pinned_words pw ON pw.word_id = w.id
      WHERE r.due <= ?
        AND (r.rating = 0 OR r.reviewed_at < ?)
      GROUP BY r.word_id
      ORDER BY MIN(r.due) DESC
      LIMIT ?
    `,
    args: [nowSec, fiveMinAgoSec, limit],
  });

  return result.rows.map((row: any) => ({
    wordId: row.w_id as string,
    word: row.w_word as string,
    phonetic: row.w_phonetic as string | null,
    definition: row.w_definition as string,
    examples: row.w_examples as string | null,
    pinned: Number(row.w_pinned) === 1,
    card: {
      due: fromUnixSec(Number(row.due)),
      stability: Number(row.stability),
      difficulty: Number(row.difficulty),
      elapsed_days: Number(row.elapsed_days),
      scheduled_days: Number(row.scheduled_days),
      reps: Number(row.reps),
      lapses: Number(row.lapses),
      learning_steps: 0,
      state: Number(row.state) as unknown as State,
    },
  }));
}

/**
 * Process a review for a word with the given rating.
 * Returns the updated card info.
 *
 * Reconstructs the Card from the latest review record, computes
 * elapsed_days from the actual time gap, then applies FSRS scheduling.
 */
export async function processReview(
  wordId: string,
  rating: Rating,
): Promise<{ card: Card; log: unknown }> {
  const now = new Date();

  // Get current card state (latest review for this word)
  const existingReview = await db
    .select()
    .from(reviews)
    .where(eq(reviews.wordId, wordId))
    .orderBy(desc(reviews.reviewedAt))
    .limit(1);

  // Prevent duplicate reviews within 2 seconds (debounce for double-click / double-keypress)
  if (existingReview.length > 0 && existingReview[0].lastReview) {
    const lastReviewTime = existingReview[0].lastReview!.getTime();
    if (now.getTime() - lastReviewTime < 2000) {
      // Return the existing card state without inserting a duplicate
      const r = existingReview[0];
      const existingCard: Card = {
        due: r.due ?? new Date(),
        stability: r.stability,
        difficulty: r.difficulty,
        elapsed_days: r.elapsedDays,
        scheduled_days: r.scheduledDays,
        reps: r.reps,
        lapses: r.lapses,
        learning_steps: 0,
        state: r.state as unknown as State,
      };
      return { card: existingCard, log: null };
    }
  }

  let card: Card;
  if (existingReview.length > 0) {
    const r = existingReview[0];
    card = {
      due: r.due ?? new Date(),
      stability: r.stability,
      difficulty: r.difficulty,
      elapsed_days: r.elapsedDays,
      scheduled_days: r.scheduledDays,
      reps: r.reps,
      lapses: r.lapses,
      learning_steps: 0,
      state: r.state as unknown as State,
    };

    // Compute real elapsed_days from last review time
    if (r.lastReview) {
      const lastReviewTime = r.lastReview.getTime();
      const elapsedMs = now.getTime() - lastReviewTime;
      card.elapsed_days = Math.max(0, Math.round(elapsedMs / (1000 * 60 * 60 * 24)));
    }
  } else {
    card = createEmptyCard();
  }

  // Calculate next scheduling
  const scheduling = engine.repeat(card, now);
  const grade = rating as Grade;
  const nextCard = scheduling[grade].card;

  // Save the review record (append-only)
  await db.insert(reviews).values({
    id: uuid(),
    wordId,
    rating,
    state: nextCard.state as number,
    due: nextCard.due,
    stability: nextCard.stability,
    difficulty: nextCard.difficulty,
    elapsedDays: nextCard.elapsed_days,
    scheduledDays: nextCard.scheduled_days,
    reps: nextCard.reps,
    lapses: nextCard.lapses,
    lastReview: now,
    reviewedAt: now,
  });

  return { card: nextCard, log: scheduling[grade].log };
}

/**
 * Create an initial review record for a new word.
 * Rating is 0 (not yet reviewed by user — excluded from stats).
 * Due is set to now so the word is immediately available for review.
 */
export async function initializeCard(wordId: string): Promise<Card> {
  const card = createEmptyCard();
  const now = new Date();

  await db.insert(reviews).values({
    id: uuid(),
    wordId,
    rating: 0,
    state: card.state as number,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: now,
    reviewedAt: now,
  });

  return card;
}

/**
 * Get proficiency distribution.
 * Uses raw SQL to avoid Drizzle timestamp deserialization issues.
 * For each word, only the latest review (by reviewedAt) determines its state.
 * Excludes initialization records (rating=0).
 */
export async function getProficiencyDistribution(): Promise<{
  new: number;
  learning: number;
  review: number;
  relearning: number;
}> {
  const result = await client.execute({
    sql: `
      SELECT r.state, COUNT(*) as count
      FROM reviews r
      INNER JOIN (
        SELECT word_id, max(reviewed_at) as max_reviewed_at
        FROM reviews
        WHERE rating > 0
        GROUP BY word_id
      ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
      GROUP BY r.state
    `,
    args: [],
  });

  const distribution = { new: 0, learning: 0, review: 0, relearning: 0 };
  for (const row of result.rows as any[]) {
    switch (Number(row.state)) {
      case State.New:
        distribution.new = Number(row.count);
        break;
      case State.Learning:
        distribution.learning = Number(row.count);
        break;
      case State.Review:
        distribution.review = Number(row.count);
        break;
      case State.Relearning:
        distribution.relearning = Number(row.count);
        break;
    }
  }
  return distribution;
}

/**
 * Get today's review statistics.
 * Excludes initialization records (rating=0) so they don't affect correctRate.
 */
export async function getDailyStats(): Promise<{
  reviewed: number;
  correctRate: number;
}> {
  const todayStartSec = toUnixSec(new Date(new Date().setHours(0, 0, 0, 0)));

  const todayReviews = await db
    .select()
    .from(reviews)
    .where(
      and(
        sql`${reviews.reviewedAt} >= ${todayStartSec}`,
        gt(reviews.rating, 0),
      ),
    );

  const reviewed = todayReviews.length;
  const correct = todayReviews.filter(r => r.rating >= Rating.Good).length;
  const correctRate = reviewed > 0 ? correct / reviewed : 0;

  return { reviewed, correctRate };
}
