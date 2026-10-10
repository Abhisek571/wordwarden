import { browser } from 'wxt/browser';
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
}

export async function loadTypingStats(): Promise<TypingStats> {
  const result = await browser.storage.local.get(TYPING_STATS_KEY);
  return parseTypingStats(result[TYPING_STATS_KEY]);
}

export async function recordTypingStats(delta: TypingStatsDelta): Promise<void> {
  await browser.storage.local.set({ [TYPING_STATS_KEY]: addTypingStats(await loadTypingStats(), delta) });
}
