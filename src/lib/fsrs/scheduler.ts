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
import { db, client } from '../db';
import { reviews } from '../db/schema';
import { eq, and, desc, sql, gt } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const engine = fsrs();

// ── New word queue ──────────────────────────────────────────────────────
// New words are "queued" by setting their due date far in the future (QUEUE_DUE_SEC).
// A daily release mechanism moves queued words into the active pool by
// setting their due to now, up to the dailyNewLimit.
//
// State transitions:
//   add-word → initializeCard() → due = QUEUE_DUE (far future, "queued")
//   releaseNewWords() → due = now ("released", available for review)
//   user reviews → processReview() → due = FSRS-calculated (normal scheduling)

/** Sentinel due timestamp for queued new words — year 2099 */
const QUEUE_DUE_SEC = Math.floor(new Date('2099-12-31T23:59:59').getTime() / 1000);

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
  audioUrl: string | null;
  definition: string;
  examples: string | null;
  pinned: boolean;
  card: Card;
  /** Is this a new (never reviewed) word? */
  isNew: boolean;
}

/**
 * Get today's daily queue info: how many new/review words are due,
 * and how many of each have already been reviewed today.
 *
 * This is the Anki-style "new + review" daily budget system.
 */
export async function getDailyQueueInfo(groupId?: string | null): Promise<{
  newDue: number;         // new words currently due (released from queue, rating=0)
  reviewDue: number;     // review words currently due (rating>0)
  newQueued: number;     // new words still in queue (not yet released)
  todayNewReviewed: number;  // new words already reviewed today
  todayReviewReviewed: number; // review words already reviewed today
  dailyNewLimit: number;     // configured daily new limit (0=unlimited)
  dailyReviewLimit: number;  // configured daily review limit (0=unlimited)
  newRemaining: number;     // new words still available today (limit - already reviewed)
  reviewRemaining: number;  // review words still available today
}> {
  // Release queued new words before computing queue info
  await releaseNewWords(groupId);

  const nowSec = toUnixSec(new Date());
  const todayStartSec = toUnixSec(new Date(new Date().setHours(0, 0, 0, 0)));

  const groupJoin = groupId
    ? 'INNER JOIN word_group_members wgm ON wgm.word_id = r.word_id AND wgm.group_id = ?'
    : '';
  const groupArgs = groupId ? [groupId] : [];

  // Count new words due (state=New, rating=0 = never reviewed by user)
  const newDueResult = await client.execute({
    sql: `
      SELECT COUNT(*) as cnt
      FROM reviews r
      INNER JOIN (
        SELECT word_id, max(reviewed_at) as max_reviewed_at
        FROM reviews
        GROUP BY word_id
      ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
      ${groupJoin}
      WHERE r.due <= ? AND r.rating = 0
    `,
    args: [...groupArgs, nowSec],
  });

  // Count review words due (state != New, or rating > 0)
  const reviewDueResult = await client.execute({
    sql: `
      SELECT COUNT(*) as cnt
      FROM reviews r
      INNER JOIN (
        SELECT word_id, max(reviewed_at) as max_reviewed_at
        FROM reviews
        GROUP BY word_id
      ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
      ${groupJoin}
      WHERE r.due <= ? AND r.rating > 0
    `,
    args: [...groupArgs, nowSec],
  });

  // Count today's reviewed new words (first review with rating > 0 for a word that was previously New)
  // A word counts as "new reviewed today" if its FIRST real review (rating>0) happened today
  const todayNewResult = await client.execute({
    sql: `
      SELECT COUNT(DISTINCT r.word_id) as cnt
      FROM reviews r
      INNER JOIN (
        SELECT word_id, MIN(reviewed_at) as first_real_review
        FROM reviews
        WHERE rating > 0
        GROUP BY word_id
      ) first ON r.word_id = first.word_id AND r.reviewed_at = first.first_real_review
      ${groupJoin.replace(/r\./g, 'first.').replace(/wgm\.word_id = r\.word_id/, 'wgm.word_id = first.word_id')}
      WHERE r.reviewed_at >= ? AND r.rating > 0
    `,
    args: [...groupArgs, todayStartSec],
  });

  // Simpler approach: count all today's reviews, then subtract new-reviewed
  const todayAllReviewedResult = await client.execute({
    sql: `
      SELECT COUNT(*) as cnt
      FROM reviews
      WHERE rating > 0 AND reviewed_at >= ?
    `,
    args: [todayStartSec],
  });

  const newDue = Number((newDueResult.rows[0] as any)?.cnt ?? 0);
  const reviewDue = Number((reviewDueResult.rows[0] as any)?.cnt ?? 0);
  const todayNewReviewed = Number((todayNewResult.rows[0] as any)?.cnt ?? 0);
  const todayAllReviewed = Number((todayAllReviewedResult.rows[0] as any)?.cnt ?? 0);
  const todayReviewReviewed = Math.max(0, todayAllReviewed - todayNewReviewed);

  // Read limits from settings
  const { getSetting } = await import('../db/settings');
  const dailyNewLimit = parseInt(await getSetting('review.dailyNewLimit'), 10) || 0;
  const dailyReviewLimit = parseInt(await getSetting('review.dailyReviewLimit'), 10) || 0;

  // Count queued (unreleased) new words
  const newQueued = await getQueuedNewCount(groupId);

  const newRemaining = dailyNewLimit > 0
    ? Math.max(0, dailyNewLimit - todayNewReviewed)
    : newDue;  // 0 = unlimited, so all due new words are available

  const reviewRemaining = dailyReviewLimit > 0
    ? Math.max(0, dailyReviewLimit - todayReviewReviewed)
    : reviewDue;  // 0 = unlimited

  return {
    newDue,
    reviewDue,
    newQueued,
    todayNewReviewed,
    todayReviewReviewed,
    dailyNewLimit,
    dailyReviewLimit,
    newRemaining,
    reviewRemaining,
  };
}

/**
 * Release queued new words into the active review pool.
 *
 * This is the Anki-style "new cards per day" mechanism:
 * - Count how many new words were already reviewed today
 * - Calculate remaining quota = dailyNewLimit - todayNewReviewed
 * - Move up to `remaining` queued words (due=QUEUE_DUE) to due=now
 *
 * Should be called before getDueWords/getDailyQueueInfo.
 * Idempotent within the same day — safe to call multiple times.
 *
 * @returns Number of words released
 */
export async function releaseNewWords(groupId?: string | null): Promise<number> {
  const { getSetting } = await import('../db/settings');
  const dailyNewLimit = parseInt(await getSetting('review.dailyNewLimit'), 10) || 0;

  // If unlimited, release all queued words
  if (dailyNewLimit === 0) {
    const result = await client.execute({
      sql: `
        UPDATE reviews SET due = ?
        WHERE rowid IN (
          SELECT r.rowid
          FROM reviews r
          INNER JOIN (
            SELECT word_id, max(reviewed_at) as max_reviewed_at
            FROM reviews
            GROUP BY word_id
          ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
          WHERE r.due >= ? AND r.rating = 0
        )
      `,
      args: [toUnixSec(new Date()), QUEUE_DUE_SEC - 86400],
    });
    return Number(result.rowsAffected ?? 0);
  }

  const nowSec = toUnixSec(new Date());
  const todayStartSec = toUnixSec(new Date(new Date().setHours(0, 0, 0, 0)));

  // Count new words already reviewed today
  const todayNewResult = await client.execute({
    sql: `
      SELECT COUNT(DISTINCT r.word_id) as cnt
      FROM reviews r
      INNER JOIN (
        SELECT word_id, MIN(reviewed_at) as first_real_review
        FROM reviews
        WHERE rating > 0
        GROUP BY word_id
      ) first ON r.word_id = first.word_id AND r.reviewed_at = first.first_real_review
      WHERE r.reviewed_at >= ? AND r.rating > 0
    `,
    args: [todayStartSec],
  });
  const todayNewReviewed = Number((todayNewResult.rows[0] as any)?.cnt ?? 0);

  // Also count new words already released (due <= now, rating=0) — they're
  // in the active pool but not yet reviewed by the user today.
  // These were released earlier today and count against the quota.
  const alreadyReleasedResult = await client.execute({
    sql: `
      SELECT COUNT(*) as cnt
      FROM reviews r
      INNER JOIN (
        SELECT word_id, max(reviewed_at) as max_reviewed_at
        FROM reviews
        GROUP BY word_id
      ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
      WHERE r.rating = 0 AND r.due <= ? AND r.due < ?
    `,
    args: [nowSec, QUEUE_DUE_SEC - 86400],
  });
  const alreadyReleased = Number((alreadyReleasedResult.rows[0] as any)?.cnt ?? 0);

  // Total "consumed" today = reviewed + released-but-not-yet-reviewed
  const consumed = todayNewReviewed + alreadyReleased;
  const remaining = Math.max(0, dailyNewLimit - consumed);

  if (remaining === 0) return 0;

  // Release `remaining` queued words: update their due from QUEUE_DUE to now
  // Order by reviewed_at (earliest added first = FIFO queue)
  const groupJoin = groupId
    ? 'INNER JOIN word_group_members wgm ON wgm.word_id = r.word_id AND wgm.group_id = ?'
    : '';

  const result = await client.execute({
    sql: `
      UPDATE reviews SET due = ?
      WHERE rowid IN (
        SELECT r.rowid
        FROM reviews r
        INNER JOIN (
          SELECT word_id, max(reviewed_at) as max_reviewed_at
          FROM reviews
          GROUP BY word_id
        ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
        ${groupJoin}
        WHERE r.due >= ? AND r.rating = 0
        ORDER BY r.reviewed_at ASC
        LIMIT ?
      )
    `,
    args: groupId
      ? [nowSec, groupId, QUEUE_DUE_SEC - 86400, remaining]
      : [nowSec, QUEUE_DUE_SEC - 86400, remaining],
  });

  return Number(result.rowsAffected ?? 0);
}

/**
 * Get the count of queued (unreleased) new words.
 */
export async function getQueuedNewCount(groupId?: string | null): Promise<number> {
  const groupJoin = groupId
    ? 'INNER JOIN word_group_members wgm ON wgm.word_id = r.word_id AND wgm.group_id = ?'
    : '';

  const result = await client.execute({
    sql: `
      SELECT COUNT(*) as cnt
      FROM reviews r
      INNER JOIN (
        SELECT word_id, max(reviewed_at) as max_reviewed_at
        FROM reviews
        GROUP BY word_id
      ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
      ${groupJoin}
      WHERE r.due >= ? AND r.rating = 0
    `,
    args: groupId ? [groupId, QUEUE_DUE_SEC - 86400] : [QUEUE_DUE_SEC - 86400],
  });

  return Number((result.rows[0] as any)?.cnt ?? 0);
}

/**
 * Get words due for review today, respecting daily new/review limits.
 *
 * Priority: review words first, then new words (up to daily limit).
 * Each word appears at most once — uses the latest review record per word
 * to determine if it's due.
 *
 * @param limit Max number of words to return (total)
 * @param groupId Optional group ID to filter by (null/undefined = all groups)
 */
export async function getDueWords(limit = 20, groupId?: string | null): Promise<DueWord[]> {
  const nowSec = toUnixSec(new Date());

  // Exclude words actually reviewed in the last 5 minutes to prevent
  // the same word appearing again in the same review session.
  const fiveMinAgoSec = nowSec - 300;

  // Get daily queue info for limit enforcement
  const queueInfo = await getDailyQueueInfo(groupId);

  // Calculate how many review vs new words to fetch
  // Priority: review words first, then new words
  const reviewSlots = queueInfo.dailyReviewLimit > 0
    ? Math.min(queueInfo.reviewRemaining, limit)
    : limit;  // unlimited review

  const newSlots = queueInfo.dailyNewLimit > 0
    ? Math.min(queueInfo.newRemaining, limit - Math.min(reviewSlots, queueInfo.reviewDue))
    : Math.max(0, limit - Math.min(reviewSlots, queueInfo.reviewDue));  // unlimited new

  // If both unlimited, just use the original limit split
  const effectiveReviewLimit = queueInfo.dailyReviewLimit > 0
    ? Math.min(reviewSlots, queueInfo.reviewDue)
    : queueInfo.reviewDue;

  const effectiveNewLimit = queueInfo.dailyNewLimit > 0
    ? Math.min(newSlots, queueInfo.newDue)
    : queueInfo.newDue;

  // Cap total to requested limit
  const totalAvailable = effectiveReviewLimit + effectiveNewLimit;
  const totalToFetch = Math.min(totalAvailable, limit);

  if (totalToFetch === 0) {
    return [];
  }

  // Fetch review words (priority)
  const reviewWords = effectiveReviewLimit > 0
    ? await fetchDueWordsByType('review', effectiveReviewLimit, groupId, nowSec, fiveMinAgoSec)
    : [];

  // Fetch new words
  const remainingSlots = Math.max(0, totalToFetch - reviewWords.length);
  const newWords = remainingSlots > 0 && effectiveNewLimit > 0
    ? await fetchDueWordsByType('new', Math.min(remainingSlots, effectiveNewLimit), groupId, nowSec, fiveMinAgoSec)
    : [];

  // Combine: review first, then new
  const allWords = [...reviewWords, ...newWords];

  return allWords.slice(0, limit);
}

/**
 * Fetch due words filtered by type (new or review).
 * New = rating=0 (never reviewed by user)
 * Review = rating>0 (has been reviewed at least once)
 */
async function fetchDueWordsByType(
  type: 'new' | 'review',
  limit: number,
  groupId: string | null | undefined,
  nowSec: number,
  fiveMinAgoSec: number,
): Promise<DueWord[]> {
  const ratingFilter = type === 'new' ? 'r.rating = 0' : 'r.rating > 0';
  // For new words, don't apply the 5-minute filter (they haven't been reviewed yet)
  const timeFilter = type === 'new'
    ? ''
    : 'AND r.reviewed_at < ?';

  const result = await client.execute({
    sql: `
      SELECT
        r.id, r.word_id, r.state, r.due, r.stability, r.difficulty,
        r.elapsed_days, r.scheduled_days, r.reps, r.lapses,
        w.id as w_id, w.word as w_word, w.phonetic as w_phonetic,
        w.audio_url as w_audio_url,
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
      ${groupId ? 'INNER JOIN word_group_members wgm ON wgm.word_id = w.id AND wgm.group_id = ?' : ''}
      WHERE r.due <= ?
        AND ${ratingFilter}
        ${timeFilter}
      GROUP BY r.word_id
      ORDER BY ${type === 'review' ? 'MIN(r.due) ASC' : 'RANDOM()'}
      LIMIT ?
    `,
    args: groupId
      ? [groupId, nowSec, ...(type === 'review' ? [fiveMinAgoSec] : []), limit]
      : [nowSec, ...(type === 'review' ? [fiveMinAgoSec] : []), limit],
  });

  return result.rows.map((row: any) => ({
    wordId: row.w_id as string,
    word: row.w_word as string,
    phonetic: row.w_phonetic as string | null,
    audioUrl: (row.w_audio_url as string | null) ?? null,
    definition: row.w_definition as string,
    examples: row.w_examples as string | null,
    pinned: Number(row.w_pinned) === 1,
    isNew: type === 'new',
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
 * Due is set to a far-future sentinel (QUEUE_DUE_SEC), meaning the word
 * is "queued" but NOT yet available for review. It will be released
 * into the active pool by releaseNewWords() when the daily quota allows.
 *
 * If dailyNewLimit is 0 (unlimited), the word is released immediately.
 */
export async function initializeCard(wordId: string): Promise<Card> {
  const card = createEmptyCard();
  const now = new Date();

  // Check if daily new limit is set — if unlimited (0), release immediately
  const { getSetting } = await import('../db/settings');
  const dailyNewLimit = parseInt(await getSetting('review.dailyNewLimit'), 10) || 0;

  // If unlimited, make the word immediately available (due = now)
  // Otherwise, queue it (due = far future sentinel)
  const dueSec = dailyNewLimit > 0 ? QUEUE_DUE_SEC : toUnixSec(now);

  await db.insert(reviews).values({
    id: uuid(),
    wordId,
    rating: 0,
    state: card.state as number,
    due: fromUnixSec(dueSec),
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
 *
 * @param groupId Optional group ID to filter by (null/undefined = all groups)
 */
export async function getProficiencyDistribution(groupId?: string | null): Promise<{
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
      ${groupId ? 'INNER JOIN word_group_members wgm ON wgm.word_id = r.word_id AND wgm.group_id = ?' : ''}
      GROUP BY r.state
    `,
    args: groupId ? [groupId] : [],
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
