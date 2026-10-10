/**
 * Today's typing numbers for the popup. Only counts are kept, never any text.
 * Speed counts typed characters (5 per word) over the time spent typing; accuracy is the share of
 * those words the checker did not flag while they were being typed.
 */
export type TypingStats = Readonly<{ day: string; characters: number; typingMs: number; mistakes: number }>;
export type TypingStatsDelta = Readonly<{ characters: number; typingMs: number; mistakes: number }>;

export const TYPING_STATS_KEY = 'typecheck.typing-stats.v1';
/** Personal bests from the typing test page. */
export const TYPING_BESTS_KEY = 'typecheck.typing-bests.v1';
/** Gaps longer than this are thinking time, not typing time. */
export const TYPING_PAUSE_MS = 3000;
// One message can carry at most a few minutes of typing; anything larger is not real input.
const MAX_DELTA = Object.freeze({ characters: 100_000, typingMs: 3_600_000, mistakes: 10_000 });

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isCount(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

export function isTypingStatsDelta(value: unknown): value is TypingStatsDelta {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return isCount(record.characters, MAX_DELTA.characters) && isCount(record.typingMs, MAX_DELTA.typingMs) &&
    isCount(record.mistakes, MAX_DELTA.mistakes);
}

/** Stored numbers from an earlier day, or broken ones, start today from zero. */
export function parseTypingStats(value: unknown, day = localDay()): TypingStats {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  if (record.day !== day || !isCount(record.characters) || !isCount(record.typingMs) || !isCount(record.mistakes)) {
    return Object.freeze({ day, characters: 0, typingMs: 0, mistakes: 0 });
  }
  return Object.freeze({ day, characters: record.characters, typingMs: record.typingMs, mistakes: record.mistakes });
}

export function addTypingStats(current: TypingStats, delta: TypingStatsDelta): TypingStats {
  return Object.freeze({
    day: current.day,
    characters: current.characters + delta.characters,
    typingMs: current.typingMs + delta.typingMs,
    mistakes: current.mistakes + delta.mistakes,
  });
}

/** Words per minute, or null until there are two seconds of typing. */
export function wordsPerMinute(characters: number, typingMs: number): number | null {
  return typingMs < 2000 ? null : Math.round(characters / 5 / (typingMs / 60_000));
}

/** Percentage of words without a mistake, or null before a whole word is typed. */
export function accuracyPercent(words: number, mistakes: number): number | null {
  if (words < 1) return null;
  // Rounded down, so a single mistake never shows as 100%.
  return Math.floor(((words - Math.min(words, mistakes)) / words) * 100);
}

/** Characters the writer typed in this input event; pastes, drops and replacements are not typing. */
export function typedCharacterCount(event: Event): number {
  if (!(event instanceof InputEvent) || !event.isTrusted) return 0;
  if (event.inputType === 'insertText') return event.data?.length ?? 0;
  return event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph' ? 1 : 0;
}

/** Times typing from input events: each keystroke adds the gap since the last one unless it was a pause. */
export function createTypingMeter(): Readonly<{
  type: (now: number, characters: number) => void;
  reset: () => void;
  read: () => Readonly<{ characters: number; typingMs: number }>;
}> {
  let characters = 0;
  let typingMs = 0;
  let lastTypedAt: number | null = null;
  return Object.freeze({
    type(now: number, typed: number): void {
      characters += typed;
      if (lastTypedAt !== null && now - lastTypedAt <= TYPING_PAUSE_MS) typingMs += now - lastTypedAt;
      lastTypedAt = now;
    },
    reset(): void {
      characters = 0;
      typingMs = 0;
      lastTypedAt = null;
    },
    read: () => Object.freeze({ characters, typingMs }),
  });
}
