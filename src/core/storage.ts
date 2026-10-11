import { browser } from 'wxt/browser';
import { RECENT_ERRORS_KEY, addRecentError, parseRecentErrors, type RecentError } from './diagnostics';
import { DEFAULT_SETTINGS, parseSettings, type TypeCheckSettings } from './settings';
import { TYPING_BESTS_KEY, TYPING_STATS_KEY, addTypingStats, parseTypingStats, type TypingStats, type TypingStatsDelta } from './typing-stats';

const SETTINGS_KEY = 'typecheck.settings.v1';

export async function loadSettings(): Promise<TypeCheckSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  return parseSettings(result[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
}

export async function saveSettings(settings: TypeCheckSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function clearSettings(): Promise<void> {
  await browser.storage.local.remove([SETTINGS_KEY, TYPING_STATS_KEY, TYPING_BESTS_KEY]);
  await browser.storage.session.remove(RECENT_ERRORS_KEY);
}

// Recent errors are kept in session storage, so they are gone when the browser closes.
export async function loadRecentErrors(): Promise<readonly RecentError[]> {
  const result = await browser.storage.session.get(RECENT_ERRORS_KEY);
  return parseRecentErrors(result[RECENT_ERRORS_KEY]);
}

export async function recordRecentError(where: RecentError['where'], message: string): Promise<void> {
  const errors = addRecentError(await loadRecentErrors(), where, message, new Date().toISOString());
  await browser.storage.session.set({ [RECENT_ERRORS_KEY]: errors });
}

export async function loadTypingStats(): Promise<TypingStats> {
  const result = await browser.storage.local.get(TYPING_STATS_KEY);
  return parseTypingStats(result[TYPING_STATS_KEY]);
}

export async function recordTypingStats(delta: TypingStatsDelta): Promise<void> {
  await browser.storage.local.set({ [TYPING_STATS_KEY]: addTypingStats(await loadTypingStats(), delta) });
}
