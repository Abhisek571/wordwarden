import { describe, expect, it } from 'vitest';
import {
  accuracyPercent, addTypingStats, createTypingMeter, isTypingStatsDelta, localDay, parseTypingStats, wordsPerMinute,
} from '#/core/typing-stats';

describe('typing stats', () => {
  it('times typing and leaves out long pauses', () => {
    const meter = createTypingMeter();
    meter.type(0, 1);
    meter.type(200, 1);
    meter.type(10_200, 1);
    meter.type(10_500, 2);
    expect(meter.read()).toEqual({ characters: 5, typingMs: 500 });
    meter.reset();
    expect(meter.read()).toEqual({ characters: 0, typingMs: 0 });
  });

  it('works out speed and accuracy', () => {
    expect(wordsPerMinute(500, 60_000)).toBe(100);
    expect(wordsPerMinute(10, 1000)).toBeNull();
    expect(accuracyPercent(20, 1)).toBe(95);
    expect(accuracyPercent(2, 5)).toBe(0);
    expect(accuracyPercent(0, 0)).toBeNull();
    expect(accuracyPercent(262, 1)).toBe(99);
  });

  it('starts each day from zero and adds counts', () => {
    const today = localDay(new Date(2026, 9, 10));
    expect(today).toBe('2026-10-10');
    const stored = { day: today, characters: 10, typingMs: 2000, mistakes: 1 };
    expect(parseTypingStats(stored, today)).toEqual(stored);
    expect(parseTypingStats(stored, '2026-10-11').characters).toBe(0);
    expect(parseTypingStats({ day: today, characters: 'x' }, today).characters).toBe(0);
    expect(addTypingStats(parseTypingStats(stored, today), { characters: 5, typingMs: 100, mistakes: 2 }))
      .toEqual({ day: today, characters: 15, typingMs: 2100, mistakes: 3 });
  });

  it('accepts only sensible counts from a page', () => {
    expect(isTypingStatsDelta({ characters: 5, typingMs: 100, mistakes: 0 })).toBe(true);
    expect(isTypingStatsDelta({ characters: -1, typingMs: 100, mistakes: 0 })).toBe(false);
    expect(isTypingStatsDelta({ characters: 5, typingMs: Number.NaN, mistakes: 0 })).toBe(false);
    expect(isTypingStatsDelta({ characters: 1e9, typingMs: 100, mistakes: 0 })).toBe(false);
    expect(isTypingStatsDelta(null)).toBe(false);
  });
});
