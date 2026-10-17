import { startTypeCheck } from '../content';
import { accuracyPercent, createTypingMeter, typedCharacterCount, wordsPerMinute } from '#/core/typing-stats';
import { browser } from 'wxt/browser';
import { TYPING_BESTS_KEY } from '#/core/typing-stats';
import { PARAGRAPHS } from './paragraphs';
import './style.css';

const invalidationCallbacks = new Set<() => void>();
let invalidated = false;

function abort(): void {
  if (invalidated) return;
  invalidated = true;
  for (const callback of invalidationCallbacks) callback();
  invalidationCallbacks.clear();
}

const status = document.querySelector('#playground-status');
const stats = Object.freeze({
  wpm: document.querySelector<HTMLElement>('[data-stat="wpm"]'),
  mistakes: document.querySelector<HTMLElement>('[data-stat="mistakes"]'),
  accuracy: document.querySelector<HTMLElement>('[data-stat="accuracy"]'),
});

void startTypeCheck(
  Object.freeze({
    abort,
    onInvalidated(callback: () => void): void {
      if (invalidated) callback();
      else invalidationCallbacks.add(callback);
    },
  }),
  Object.freeze({ alwaysEnabled: true }),
).catch((error: unknown) => {
  if (status !== null) {
    status.textContent = `Wordwarden could not start: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
});

window.addEventListener('pagehide', (event: PageTransitionEvent) => {
  if (!event.persisted) abort();
});

const editor = document.querySelector<HTMLTextAreaElement>('#editor');


// Typing-test numbers. Speed counts only typed characters (5 per word) over the time spent typing:
// pauses longer than a few seconds are left out, and a new test starts over.
const meter = createTypingMeter();

// Mistakes are words that differ from the test paragraph.
type TestState = Readonly<{ words: readonly string[]; finished: boolean }>;
let test: TestState | null = null;
let testWrong = 0;
let testCompleted = 0;
const target = document.querySelector<HTMLElement>('[data-testid="test-target"]');
const result = document.querySelector<HTMLElement>('[data-testid="test-result"]');
const startButton = document.querySelector<HTMLButtonElement>('[data-action="start"]');
const stopButton = document.querySelector<HTMLButtonElement>('[data-action="stop"]');
const timerValue = document.querySelector<HTMLElement>('[data-stat="time"]');
const resetBests = document.querySelector<HTMLButtonElement>('[data-action="reset-bests"]');

// The clock starts with the first key typed in a test and stops when the test ends or is stopped.
let testStartedAt: number | null = null;
let testElapsed = 0;
let timerHandle: number | null = null;

function formatTime(ms: number): string {
  const tenths = Math.floor(ms / 100);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

function renderTimer(): void {
  if (testStartedAt !== null) testElapsed = performance.now() - testStartedAt;
  if (timerValue !== null) timerValue.textContent = formatTime(testElapsed);
}

function stopTimer(): void {
  renderTimer();
  testStartedAt = null;
  if (timerHandle !== null) window.clearInterval(timerHandle);
  timerHandle = null;
}

// Personal bests and averages, kept for finished tests on this page only.
const RECORD_KEYS = Object.freeze(['time', 'wpm', 'accuracy', 'mistakes'] as const);
type RecordKey = (typeof RECORD_KEYS)[number];
type Total = Readonly<{ sum: number; count: number }>;
type Records = Readonly<{ best: Partial<Record<RecordKey, number>>; total: Partial<Record<RecordKey, Total>> }>;
const LOWER_IS_BETTER: ReadonlySet<RecordKey> = new Set(['time', 'mistakes']);
let records: Records = Object.freeze({ best: {}, total: {} });

function showRecord(key: RecordKey, value: number | undefined, kind: 'best' | 'average'): void {
  const cell = document.querySelector<HTMLElement>(`[data-${kind}="${key}"]`);
  if (cell === null) return;
  if (value === undefined) cell.textContent = '–';
  else if (key === 'time') cell.textContent = formatTime(value);
  else if (key === 'accuracy') cell.textContent = `${Math.floor(value)}%`;
  else cell.textContent = kind === 'average' && key === 'mistakes' ? value.toFixed(1) : String(Math.round(value));
}

function renderBests(): void {
  for (const key of RECORD_KEYS) {
    showRecord(key, records.best[key], 'best');
    const total = records.total[key];
    showRecord(key, total === undefined || total.count === 0 ? undefined : total.sum / total.count, 'average');
  }
  const count = records.total.time?.count ?? 0;
  const tests = document.querySelector('[data-testid="average-count"]');
  if (tests !== null) tests.textContent = count === 0 ? '' : `${count} test${count === 1 ? '' : 's'}`;
  if (resetBests !== null) resetBests.hidden = count === 0 && Object.keys(records.best).length === 0;
}

function saveRecords(next: Records): void {
  records = next;
  renderBests();
  void browser.storage.local.set({ [TYPING_BESTS_KEY]: next }).catch(() => undefined);
}

function recordBests(time: number, wpm: number | null, accuracy: number | null, mistakes: number): void {
  const results: Record<RecordKey, number | null> = { time, wpm, accuracy, mistakes };
  const best: Partial<Record<RecordKey, number>> = { ...records.best };
  const total: Partial<Record<RecordKey, Total>> = { ...records.total };
  for (const key of RECORD_KEYS) {
    const value = results[key];
    if (value === null) continue;
    const old = best[key];
    if (old === undefined || (LOWER_IS_BETTER.has(key) ? value < old : value > old)) best[key] = value;
    const sum = total[key] ?? { sum: 0, count: 0 };
    total[key] = Object.freeze({ sum: sum.sum + value, count: sum.count + 1 });
  }
  saveRecords(Object.freeze({ best, total }));
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

void browser.storage.local.get(TYPING_BESTS_KEY).then((stored) => {
  const value = stored[TYPING_BESTS_KEY];
  if (typeof value !== 'object' || value === null) return;
  const record = value as Partial<Record<'best' | 'total', Record<string, unknown>>>;
  const best: Partial<Record<RecordKey, number>> = {};
  const total: Partial<Record<RecordKey, Total>> = {};
  for (const key of RECORD_KEYS) {
    // Bests saved before averages existed were stored flat, without the "best" level.
    const bestValue = record.best?.[key] ?? (value as Record<string, unknown>)[key];
    if (isCount(bestValue)) best[key] = bestValue;
    const totalValue = record.total?.[key] as Partial<Total> | undefined;
    if (isCount(totalValue?.sum) && isCount(totalValue?.count)) total[key] = Object.freeze({ sum: totalValue.sum, count: totalValue.count });
  }
  records = Object.freeze({ best, total });
  renderBests();
}, () => undefined);

resetBests?.addEventListener('click', () => {
  if (window.confirm('Reset your typing test average and best?')) saveRecords(Object.freeze({ best: {}, total: {} }));
});

// The current result follows the test being typed; after a test is stopped it keeps its last numbers.
function renderStats(): void {
  if (test === null) return;
  const typing = meter.read();
  const wpm = wordsPerMinute(typing.characters, typing.typingMs);
  const accuracy = accuracyPercent(testCompleted, testWrong);
  if (stats.wpm !== null) stats.wpm.textContent = wpm === null ? '–' : String(wpm);
  if (stats.mistakes !== null) stats.mistakes.textContent = String(testWrong);
  if (stats.mistakes !== null) stats.mistakes.dataset.some = String(testWrong > 0);
  if (stats.accuracy !== null) stats.accuracy.textContent = accuracy === null ? '–' : `${accuracy}%`;
  if (test?.finished === true && result !== null) {
    result.textContent = `Finished: ${wpm ?? '–'} WPM, ${accuracy ?? '–'}% accuracy, ${testWrong} wrong word${testWrong === 1 ? '' : 's'}.`;
  }
}

// Marks each paragraph word as right, wrong or next, and ends the test after the last word.
function trackTest(): void {
  const current = test;
  if (current === null || target === null) return;
  const value = editor?.value ?? '';
  const typed = value.trim().split(/\s+/u).filter((word) => word.length > 0);
  const last = current.words.length - 1;
  let completed = /\s$/u.test(value) ? typed.length : Math.max(0, typed.length - 1);
  if (typed.length === current.words.length && typed[last] === current.words[last]) completed = typed.length;
  completed = Math.min(completed, current.words.length);
  testCompleted = completed;
  testWrong = 0;
  target.querySelectorAll('span').forEach((span, index) => {
    const state = index < completed ? (typed[index] === current.words[index] ? 'right' : 'wrong') : index === completed ? 'next' : '';
    if (state === 'wrong') testWrong += 1;
    if (state === '') delete span.dataset.state;
    else span.dataset.state = state;
    // Keep the next word in view in the side copy, about a third of the way down.
    if (state === 'next') target.scrollTop = span.offsetTop - target.clientHeight / 3;
  });
  renderGhost(current, typed, completed, value);
  if (completed === current.words.length && !current.finished) {
    test = Object.freeze({ ...current, finished: true });
    stopTimer();
    if (startButton !== null) startButton.textContent = 'Start another test';
    if (stopButton !== null) stopButton.hidden = true;
    const typing = meter.read();
    // A pasted paragraph finishes the test at once; only a typed, timed test counts toward the bests.
    if (testElapsed > 0 && typing.characters > 0 && typing.typingMs > 0) {
      recordBests(testElapsed, wordsPerMinute(typing.characters, typing.typingMs), accuracyPercent(testCompleted, testWrong), testWrong);
    }
  }
}

const ghost = document.querySelector<HTMLElement>('.ghost');
const ghostTyped = document.querySelector<HTMLElement>('.ghost-typed');
const ghostRest = document.querySelector<HTMLElement>('.ghost-rest');

// The faint copy shows what is left to type, starting right after the cursor. It follows the words, not the
// letters, so a mistyped word does not push the rest of the paragraph out of line.
function renderGhost(current: TestState | null, typed: readonly string[], completed: number, value: string): void {
  if (ghostTyped === null || ghostRest === null) return;
  if (current === null || completed >= current.words.length) {
    ghostTyped.textContent = '';
    ghostRest.textContent = '';
    return;
  }
  const partial = completed < typed.length ? typed[completed] ?? '' : '';
  const word = current.words[completed] ?? '';
  const rest = current.words.slice(completed + 1).join(' ');
  const remainder = partial.length > 0
    ? `${word.slice(partial.length)}${rest.length > 0 ? ` ${rest}` : ''}`
    : `${value.length > 0 && !/\s$/u.test(value) ? ' ' : ''}${current.words.slice(completed).join(' ')}`;
  ghostTyped.textContent = value;
  ghostRest.textContent = remainder;
  syncGhostScroll();
}

function syncGhostScroll(): void {
  if (ghost !== null && editor !== null) ghost.scrollTop = editor.scrollTop;
}
editor?.addEventListener('scroll', syncGhostScroll);

function setEditorText(text: string): void {
  if (editor === null) return;
  editor.value = text;
  editor.focus();
  // A synthetic input event: the checker runs again and the speed starts over.
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// Each test strings random paragraphs together until even the fastest typist on record (about 216 WPM)
// would need a full minute, plus a fifth to spare.
const TEST_WORDS = 260;

function testWords(): string[] {
  const order = PARAGRAPHS.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap] ?? 0, order[index] ?? 0];
  }
  const words: string[] = [];
  for (const index of order) {
    if (words.length >= TEST_WORDS) break;
    words.push(...(PARAGRAPHS[index] ?? '').split(' '));
  }
  return words;
}
startButton?.addEventListener('click', () => {
  if (target === null) return;
  const words = testWords();
  target.replaceChildren(...words.flatMap((word, index) => {
    const span = document.createElement('span');
    span.textContent = word;
    return index === 0 ? [span] : [' ', span];
  }));
  target.hidden = false;
  if (result !== null) result.textContent = '';
  test = Object.freeze({ words, finished: false });
  startButton.textContent = 'New paragraph';
  if (stopButton !== null) stopButton.hidden = false;
  stopTimer();
  testElapsed = 0;
  renderTimer();
  setEditorText('');
});

stopButton?.addEventListener('click', () => {
  if (test === null || test.finished) return;
  stopTimer();
  test = null;
  stopButton.hidden = true;
  if (startButton !== null) startButton.textContent = 'Start typing test';
  if (result !== null) result.textContent = `Test stopped after ${formatTime(testElapsed)}. Stopped tests do not count toward your average or best.`;
  if (target !== null) target.hidden = true;
  renderGhost(null, [], 0, '');
  renderStats();
  editor?.focus();
});

document.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
  // Clearing mid-test starts the clock again from the next key.
  if (test !== null && !test.finished) {
    stopTimer();
    testElapsed = 0;
    renderTimer();
  }
  setEditorText('');
});

editor?.addEventListener('input', (event) => {
  if (!(event instanceof InputEvent) || !event.isTrusted || (editor?.value.trim().length ?? 0) === 0) meter.reset();
  else if (test?.finished !== true) meter.type(performance.now(), typedCharacterCount(event));
  if (test !== null && !test.finished && testStartedAt === null && typedCharacterCount(event) > 0) {
    testStartedAt = performance.now();
    timerHandle = window.setInterval(renderTimer, 100);
  }
  trackTest();
  renderStats();
});
renderStats();

// The typing test panel can be tucked away; the choice is remembered on this device only.
const workspace = document.querySelector<HTMLElement>('.workspace');
const panelToggle = document.querySelector<HTMLButtonElement>('.panel-toggle');
const PANEL_KEY = 'wordwarden-playground-panel';

function setPanelHidden(hidden: boolean): void {
  if (workspace === null || panelToggle === null) return;
  if (hidden) workspace.dataset.panel = 'hidden';
  else delete workspace.dataset.panel;
  panelToggle.setAttribute('aria-expanded', String(!hidden));
  panelToggle.setAttribute('aria-label', hidden ? 'Show typing test' : 'Hide typing test');
  const label = panelToggle.querySelector('.panel-toggle-label');
  if (label !== null) label.textContent = hidden ? 'Show' : 'Hide';
}

try {
  setPanelHidden(localStorage.getItem(PANEL_KEY) === 'hidden');
} catch {
  // Storage can be blocked; the panel then simply starts open.
}

panelToggle?.addEventListener('click', () => {
  const hidden = workspace?.dataset.panel !== 'hidden';
  setPanelHidden(hidden);
  try {
    localStorage.setItem(PANEL_KEY, hidden ? 'hidden' : 'shown');
  } catch {
    // Not remembered when storage is blocked.
  }
});
