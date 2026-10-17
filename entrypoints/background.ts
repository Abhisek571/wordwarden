import { browser } from 'wxt/browser';
import {
  clearSettings, loadRecentErrors, loadSettings, recordRecentError, recordTypingStats, saveSettings,
} from '#/core/storage';
import { PAGE_STATUS_REQUEST, isRuntimeRequest, type Diagnostics, type RuntimeResponse } from '#/core/messages';
import { mergeSettings, parseSettings, type TypeCheckSettings } from '#/core/settings';
import { createDiagnostics, isPageStatus, type PageStatus, type RecentError } from '#/core/diagnostics';
import { createEngineService } from '#/engines/engine-service';

const PAGE_STATUS_TIMEOUT_MS = 1500;
// Started on the first check. The browser frees it with the rest of the background after a short idle time.
const engine = createEngineService();
let settingsWriteTail: Promise<void> = Promise.resolve();
// Settings as last read, for checks, which need them each time. Forgotten whenever stored settings change.
let settingsForChecks: Promise<TypeCheckSettings> | null = null;
let errorWriteTail: Promise<void> = Promise.resolve();

// One at a time, so two errors arriving together are both kept. A failure to record is not reported again.
function recordError(where: RecentError['where'], message: string): Promise<void> {
  errorWriteTail = errorWriteTail.then(() => recordRecentError(where, message)).catch(() => undefined);
  return errorWriteTail;
}

// Asks the content script on that tab how checking went. No answer (no page, not checked yet) is null.
async function pageStatus(tabId: number | null): Promise<PageStatus | null> {
  if (tabId === null) return null;
  const timeout = new Promise<null>((done) => setTimeout(() => done(null), PAGE_STATUS_TIMEOUT_MS));
  const answer = browser.tabs.sendMessage(tabId, Object.freeze({ type: PAGE_STATUS_REQUEST }))
    .then((value: unknown) => (isPageStatus(value) ? value : null), () => null);
  return Promise.race([answer, timeout]);
}

// Both sides come from parseSettings, so their fields are in the same order and a whole comparison is exact.
function settingsEqual(left: TypeCheckSettings, right: TypeCheckSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function enqueueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = settingsWriteTail.then(operation).finally(forgetSettings);
  settingsWriteTail = result.then(() => undefined, () => undefined);
  return result;
}

function forgetSettings(): void {
  settingsForChecks = null;
}

function checkSettings(): Promise<TypeCheckSettings> {
  settingsForChecks ??= loadSettings().catch((error: unknown) => {
    forgetSettings();
    throw error;
  });
  return settingsForChecks;
}

// Requests only the popup and Settings may make. A content script runs inside web pages, so it may not wipe or
// replace settings or read the diagnostic log.
const EXTENSION_PAGE_REQUESTS = new Set(['data:clear', 'settings:replace', 'site:set-enabled', 'diagnostics']);

export async function handleRequest(
  request: unknown,
  sender: Readonly<{ tab?: unknown }> = Object.freeze({}),
): Promise<RuntimeResponse> {
  if (!isRuntimeRequest(request)) return Object.freeze({ ok: false, error: 'Invalid request.' });
  if (sender.tab !== undefined && EXTENSION_PAGE_REQUESTS.has(request.type)) {
    return Object.freeze({ ok: false, error: 'Not allowed from a web page.' });
  }
  if (request.type === 'settings:get') {
    return Object.freeze({ ok: true, settings: await loadSettings() });
  }
  if (request.type === 'settings:replace') {
    return enqueueSettingsWrite(async () => {
      const settings = parseSettings(request.settings);
      await saveSettings(settings);
      return Object.freeze({ ok: true, settings });
    });
  }
  if (request.type === 'settings:update') {
    return enqueueSettingsWrite(async () => {
      const current = await loadSettings();
      // A list changed in another tab since this one read it: apply only this tab's additions and removals to the
      // stored list, so neither tab's change is lost.
      const patch: Record<string, unknown> = { ...request.patch };
      for (const field of ['dictionary', 'ignoredIssueHashes', 'disabledSites'] as const) {
        const base = request.base?.[field];
        const next = request.patch[field];
        if (next === undefined || base === undefined) continue;
        if (base.length === current[field].length && base.every((value, index) => value === current[field][index])) continue;
        const added = next.filter((value) => !base.includes(value));
        const removed = new Set(base.filter((value) => !next.includes(value)));
        const merged = [...new Set([...current[field].filter((value) => !removed.has(value)), ...added])];
        patch[field] = field === 'ignoredIssueHashes' ? merged : merged.sort();
      }
      const settings = mergeSettings(current, patch as Partial<TypeCheckSettings>);
      if (settingsEqual(current, settings)) return Object.freeze({ ok: true, settings: current });
      await saveSettings(settings);
      return Object.freeze({ ok: true, settings });
    });
  }
  if (request.type === 'site:set-enabled') {
    return enqueueSettingsWrite(async () => {
      const current = await loadSettings();
      const disabled = new Set(current.disabledSites);
      const hostname = request.hostname.toLowerCase();
      if (request.enabled) disabled.delete(hostname);
      else disabled.add(hostname);
      const settings = mergeSettings(current, { disabledSites: [...disabled].sort() });
      await saveSettings(settings);
      return Object.freeze({ ok: true, settings });
    });
  }
  if (request.type === 'typing-stats:add') {
    // Queued with settings writes so tabs typing at the same time never overwrite each other's counts.
    return enqueueSettingsWrite(async () => {
      if ((await loadSettings()).typingStats) await recordTypingStats(request.delta);
      return Object.freeze({ ok: true });
    });
  }
  if (request.type === 'error:report') {
    await recordError('page', request.message);
    return Object.freeze({ ok: true });
  }
  if (request.type === 'engine:keep-alive') {
    // A field got focus: start the engine now, so the first check does not wait for it.
    void checkSettings().then((settings) => engine.warm(settings)).catch(() => undefined);
    return Object.freeze({ ok: true });
  }
  if (request.type === 'engine:lint') {
    const issues = await engine.lint(request.text, await checkSettings());
    return Object.freeze({ ok: true, issues });
  }
  if (request.type === 'data:clear') {
    return enqueueSettingsWrite(async () => {
      await clearSettings();
      return Object.freeze({ ok: true });
    });
  }
  const [settings, platform, page, recentErrors] = await Promise.all([
    loadSettings(),
    browser.runtime.getPlatformInfo(),
    pageStatus(request.tabId),
    errorWriteTail.then(loadRecentErrors),
  ]);
  const diagnostics: Diagnostics = createDiagnostics(settings, {
    generatedAt: new Date().toISOString(),
    extensionVersion: browser.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    platformOs: platform.os,
    hostname: request.hostname,
    page,
    webAssemblyAvailable: request.webAssemblyAvailable,
    recentErrors,
  });
  return Object.freeze({ ok: true, diagnostics });
}

export default defineBackground(() => {
  browser.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === 'local') forgetSettings();
  });
  browser.runtime.onMessage.addListener((request: unknown, sender: { tab?: unknown }) =>
    handleRequest(request, sender).catch((error: unknown): RuntimeResponse => {
      const message = error instanceof Error ? error.message : String(error);
      void recordError('background', message);
      return Object.freeze({ ok: false, error: message });
    }),
  );
});
