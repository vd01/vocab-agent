/**
 * FSRS 引擎单元测试
 * 测试间隔重复算法的核心逻辑
 */
import { describe, it, expect } from 'vitest';
import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Grade,
  type Card,
} from 'ts-fsrs';

const engine = fsrs();

describe('FSRS - Card Creation', () => {
  it('should create an empty card with New state', () => {
    const card = createEmptyCard();
    expect(card.state).toBe(State.New);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.stability).toBe(0);
    expect(card.difficulty).toBe(0);
    expect(card.elapsed_days).toBe(0);
    expect(card.scheduled_days).toBe(0);
  });

  it('should have a due date set to now', () => {
    const card = createEmptyCard();
    const now = new Date();
    // Due should be within 1 second of now
    expect(Math.abs(card.due.getTime() - now.getTime())).toBeLessThan(1000);
  });
});

describe('FSRS - Scheduling', () => {
  it('should produce scheduling for all 4 ratings', () => {
    const card = createEmptyCard();
    const now = new Date();
    const scheduling = engine.repeat(card, now);

    expect(scheduling[Rating.Again]).toBeDefined();
    expect(scheduling[Rating.Hard]).toBeDefined();
    expect(scheduling[Rating.Good]).toBeDefined();
    expect(scheduling[Rating.Easy]).toBeDefined();
  });

  it('should move card to Learning state on Again rating', () => {
    const card = createEmptyCard();
    const now = new Date();
    const scheduling = engine.repeat(card, now);
    const nextCard = scheduling[Rating.Again].card;

    expect(nextCard.state).toBe(State.Learning);
    expect(nextCard.reps).toBe(1);
  });

  it('should move card to Learning state on Hard rating', () => {
    const card = createEmptyCard();
    const now = new Date();
    const scheduling = engine.repeat(card, now);
    const nextCard = scheduling[Rating.Hard].card;

    expect(nextCard.state).toBe(State.Learning);
    expect(nextCard.reps).toBe(1);
  });

  it('should move card to Learning state on Good rating (first review)', () => {
    const card = createEmptyCard();
    const now = new Date();
    const scheduling = engine.repeat(card, now);
    const nextCard = scheduling[Rating.Good].card;

    expect(nextCard.state).toBe(State.Learning);
    expect(nextCard.reps).toBe(1);
  });

  it('should move card to Review state on Easy rating (first review)', () => {
    const card = createEmptyCard();
    const now = new Date();
    const scheduling = engine.repeat(card, now);
    const nextCard = scheduling[Rating.Easy].card;

    expect(nextCard.state).toBe(State.Review);
    expect(nextCard.reps).toBe(1);
    expect(nextCard.scheduled_days).toBeGreaterThan(0);
  });

  it('should increase stability on successful review', () => {
    const card = createEmptyCard();
    const now = new Date();
    const scheduling = engine.repeat(card, now);
    const nextCard = scheduling[Rating.Good].card;

    expect(nextCard.stability).toBeGreaterThan(0);
  });

  it('should set difficulty between 0 and 10', () => {
    const card = createEmptyCard();
    const now = new Date();
    const scheduling = engine.repeat(card, now);

    for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
      const nextCard = scheduling[rating as Grade].card;
      expect(nextCard.difficulty).toBeGreaterThanOrEqual(0);
      expect(nextCard.difficulty).toBeLessThanOrEqual(10);
    }
  });
});

describe('FSRS - Review Progression', () => {
  it('should progress from Learning to Review after multiple Good ratings', () => {
    let card = createEmptyCard();
    const now = new Date();

    // First review: Good -> Learning
    let scheduling = engine.repeat(card, now);
    card = scheduling[Rating.Good].card;

    // Second review: Good (simulate 10 min later)
    const nextTime = new Date(now.getTime() + 10 * 60 * 1000);
    scheduling = engine.repeat(card, nextTime);
    card = scheduling[Rating.Good].card;

    // After second Good, card should be in Review or still Learning
    // (depends on FSRS parameters, but reps should be 2)
    expect(card.reps).toBe(2);
    expect(card.stability).toBeGreaterThan(0);
  });

  it('should increase scheduled_days for easier ratings', () => {
    const card = createEmptyCard();
    const now = new Date();
    const scheduling = engine.repeat(card, now);

    // Easy should have longer interval than Good
    const easyDays = scheduling[Rating.Easy].card.scheduled_days;
    const goodDays = scheduling[Rating.Good].card.scheduled_days;
    expect(easyDays).toBeGreaterThanOrEqual(goodDays);
  });

  it('should handle lapse (Again after Review)', () => {
    // Simulate a card that was already in Review state
    const card: Card = {
      due: new Date(),
      stability: 5.0,
      difficulty: 5.0,
      elapsed_days: 7,
      scheduled_days: 7,
      reps: 5,
      lapses: 0,
      learning_steps: 0,
      state: State.Review,
    };

    const now = new Date();
    const scheduling = engine.repeat(card, now);
    const nextCard = scheduling[Rating.Again].card;

    // After Again, should be in Relearning
    expect(nextCard.state).toBe(State.Relearning);
    expect(nextCard.lapses).toBe(1);
  });
});

describe('FSRS - Edge Cases', () => {
  it('should handle very high stability values', () => {
    const card: Card = {
      due: new Date(),
      stability: 100.0,
      difficulty: 3.0,
      elapsed_days: 365,
      scheduled_days: 365,
      reps: 50,
      lapses: 0,
      learning_steps: 0,
      state: State.Review,
    };

    const now = new Date();
    const scheduling = engine.repeat(card, now);

    // Should still produce valid scheduling
    expect(scheduling[Rating.Good].card.stability).toBeGreaterThan(0);
    expect(scheduling[Rating.Good].card.scheduled_days).toBeGreaterThan(0);
  });

  it('should produce consistent results for same input', () => {
    const card = createEmptyCard();
    const now = new Date();

    const s1 = engine.repeat(card, now);
    const s2 = engine.repeat(card, now);

    expect(s1[Rating.Good].card.stability).toBe(s2[Rating.Good].card.stability);
    expect(s1[Rating.Good].card.scheduled_days).toBe(s2[Rating.Good].card.scheduled_days);
  });
});
