import { browser } from 'wxt/browser';
import { isRuntimeResponse, type SettingsConflictBase, type SettingsPatch } from '#/core/messages';
import type { TypeCheckSettings } from '#/core/settings';

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function changedFields(current: TypeCheckSettings, next: TypeCheckSettings): SettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const field of Object.keys(current) as (keyof TypeCheckSettings)[]) {
    if (!valuesEqual(current[field], next[field])) patch[field] = next[field];
  }
  return patch as SettingsPatch;
}

function conflictBases(current: TypeCheckSettings, patch: SettingsPatch): SettingsConflictBase | undefined {
  const base: Record<string, readonly string[]> = {};
  for (const field of ['disabledSites', 'dictionary', 'ignoredIssueHashes'] as const) {
    if (patch[field] !== undefined) base[field] = current[field];
  }
  return Object.keys(base).length === 0 ? undefined : base as SettingsConflictBase;
}

export async function updateSettings(
  current: TypeCheckSettings,
  next: TypeCheckSettings,
): Promise<TypeCheckSettings> {
  const patch = changedFields(current, next);
  if (Object.keys(patch).length === 0) return current;

  const base = conflictBases(current, patch);
  const response: unknown = await browser.runtime.sendMessage({ type: 'settings:update', patch, ...(base && { base }) });
  if (!isRuntimeResponse(response)) throw new Error('Invalid settings update response.');
  if (!response.ok) throw new Error(response.error);
  if (!('settings' in response)) throw new Error('Invalid settings update response.');
  return response.settings;
}
