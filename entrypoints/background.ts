import { browser } from 'wxt/browser';
import { clearSettings, loadSettings, recordTypingStats, saveSettings } from '#/core/storage';
import { isRuntimeRequest, type Diagnostics, type RuntimeResponse } from '#/core/messages';
import { mergeSettings, parseSettings, type TypeCheckSettings } from '#/core/settings';
import { createDiagnostics } from '#/core/diagnostics';

let settingsWriteTail: Promise<void> = Promise.resolve();

// Both sides come from parseSettings, so their fields are in the same order and a whole comparison is exact.
function settingsEqual(left: TypeCheckSettings, right: TypeCheckSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function enqueueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = settingsWriteTail.then(operation);
  settingsWriteTail = result.then(() => undefined, () => undefined);
  return result;
}

export async function handleRequest(request: unknown): Promise<RuntimeResponse> {
  if (!isRuntimeRequest(request)) return Object.freeze({ ok: false, error: 'Invalid request.' });
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
      for (const field of ['dictionary', 'ignoredIssueHashes', 'disabledSites'] as const) {
        const base = request.base?.[field];
        if (request.patch[field] !== undefined && base !== undefined &&
            (base.length !== current[field].length || base.some((value, index) => value !== current[field][index]))) {
          throw new Error('Settings changed in another tab. Reload this page and try again.');
        }
      }
      const settings = mergeSettings(current, request.patch);
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
  if (request.type === 'data:clear') {
    return enqueueSettingsWrite(async () => {
      await clearSettings();
      return Object.freeze({ ok: true });
    });
  }
  const settings = await loadSettings();
  const manifest = browser.runtime.getManifest();
  const platform = await browser.runtime.getPlatformInfo();
  const diagnostics: Diagnostics = createDiagnostics(settings, {
    generatedAt: new Date().toISOString(),
    extensionName: manifest.name,
    extensionVersion: manifest.version,
    manifestVersion: manifest.manifest_version,
    userAgent: navigator.userAgent,
    platformOs: platform.os,
    hostname: request.hostname,
    webGpuAvailable: request.capabilities.webGpuAvailable,
    webAssemblyAvailable: request.capabilities.webAssemblyAvailable,
    workerAvailable: request.capabilities.workerAvailable,
  });
  return Object.freeze({ ok: true, diagnostics });
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((request: unknown) =>
    handleRequest(request).catch((error: unknown): RuntimeResponse =>
      Object.freeze({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
  );
});
