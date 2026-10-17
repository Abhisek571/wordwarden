import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type TypeCheckSettings } from '#/core/settings';

const storage = vi.hoisted(() => ({
  loadSettings: vi.fn<() => Promise<TypeCheckSettings>>(),
  saveSettings: vi.fn<(settings: TypeCheckSettings) => Promise<void>>(),
  clearSettings: vi.fn<() => Promise<void>>(),
  recordTypingStats: vi.fn<(delta: unknown) => Promise<void>>(),
  loadRecentErrors: vi.fn<() => Promise<readonly unknown[]>>(),
  recordRecentError: vi.fn<(where: string, message: string) => Promise<void>>(),
}));
const tabs = vi.hoisted(() => ({ sendMessage: vi.fn<(tabId: number, message: unknown) => Promise<unknown>>() }));

vi.mock('#/core/storage', () => storage);
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      getManifest: vi.fn(),
      getPlatformInfo: vi.fn(),
      onMessage: { addListener: vi.fn() },
    },
    tabs,
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('defineBackground', vi.fn());
});

describe('background settings writes', () => {
  it('serializes concurrent site updates so neither change is lost', async () => {
    let stored: TypeCheckSettings = DEFAULT_SETTINGS;
    storage.loadSettings.mockImplementation(async () => stored);
    storage.saveSettings.mockImplementation(async (settings) => {
      stored = settings;
    });

    const { handleRequest } = await import('../entrypoints/background');
    await Promise.all([
      handleRequest({ type: 'site:set-enabled', hostname: 'one.example', enabled: false }),
      handleRequest({ type: 'site:set-enabled', hostname: 'two.example', enabled: false }),
    ]);

    expect(stored.disabledSites).toEqual(['one.example', 'two.example']);
  });

  it('keeps changes made in another tab when a stale list arrives', async () => {
    let stored: TypeCheckSettings = { ...DEFAULT_SETTINGS, dictionary: ['newword'] };
    storage.loadSettings.mockImplementation(async () => stored);
    storage.saveSettings.mockImplementation(async (settings) => {
      stored = settings;
    });
    const { handleRequest } = await import('../entrypoints/background');
    await handleRequest({ type: 'settings:update', patch: { dictionary: ['imported'] }, base: { dictionary: [] } });
    expect(stored.dictionary).toEqual(['imported', 'newword']);
  });

  it.each([
    ['dictionary', { dictionary: ['first'] }, { dictionary: ['second'] }, { dictionary: [] }, 'dictionary'],
    ['ignored issue hashes', { ignoredIssueHashes: ['first'] }, { ignoredIssueHashes: ['second'] }, { ignoredIssueHashes: [] }, 'ignoredIssueHashes'],
    ['disabled sites', { disabledSites: ['first.example'] }, { disabledSites: ['second.example'] }, { disabledSites: [] }, 'disabledSites'],
  ] as const)('merges concurrent %s array edits from two tabs', async (_field, firstPatch, secondPatch, base, key) => {
    let stored: TypeCheckSettings = DEFAULT_SETTINGS;
    storage.loadSettings.mockImplementation(async () => stored);
    storage.saveSettings.mockImplementation(async (settings) => {
      stored = settings;
    });
    const { handleRequest } = await import('../entrypoints/background');

    await Promise.all([
      handleRequest({ type: 'settings:update', patch: firstPatch, base }),
      handleRequest({ type: 'settings:update', patch: secondPatch, base }),
    ]);

    expect([...stored[key]].sort()).toEqual([...Object.values(firstPatch)[0], ...Object.values(secondPatch)[0]].sort());
  });

  it('refuses requests that wipe or replace settings from a web page', async () => {
    const { handleRequest } = await import('../entrypoints/background');
    for (const type of ['data:clear', 'settings:replace'] as const) {
      const request = type === 'data:clear' ? { type } : { type, settings: DEFAULT_SETTINGS };
      await expect(handleRequest(request, { tab: { id: 1 } })).resolves.toMatchObject({ ok: false });
    }
    expect(storage.saveSettings).not.toHaveBeenCalled();
  });

  it('returns authoritative settings without saving a no-op patch', async () => {
    const stored = { ...DEFAULT_SETTINGS, dictionary: ['existing'] };
    storage.loadSettings.mockResolvedValue(stored);
    const { handleRequest } = await import('../entrypoints/background');

    await expect(handleRequest({ type: 'settings:update', patch: { dictionary: ['existing'] } }))
      .resolves.toEqual({ ok: true, settings: stored });
    expect(storage.saveSettings).not.toHaveBeenCalled();
  });

  it('records typing counts only while typing stats are on', async () => {
    const delta = { characters: 120, typingMs: 30_000, mistakes: 2 };
    storage.loadSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { handleRequest } = await import('../entrypoints/background');
    await expect(handleRequest({ type: 'typing-stats:add', delta })).resolves.toEqual({ ok: true });
    expect(storage.recordTypingStats).toHaveBeenCalledWith(delta);

    storage.recordTypingStats.mockClear();
    storage.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, typingStats: false });
    await handleRequest({ type: 'typing-stats:add', delta });
    expect(storage.recordTypingStats).not.toHaveBeenCalled();
    await expect(handleRequest({ type: 'typing-stats:add', delta: { ...delta, characters: -1 } }))
      .resolves.toEqual({ ok: false, error: 'Invalid request.' });
  });

  it('saves a colour-vision change', async () => {
    let stored: TypeCheckSettings = DEFAULT_SETTINGS;
    storage.loadSettings.mockImplementation(async () => stored);
    storage.saveSettings.mockImplementation(async (settings) => {
      stored = settings;
    });

    const { handleRequest } = await import('../entrypoints/background');
    await handleRequest({ type: 'settings:update', patch: { colorVision: 'red-green' } });

    expect(stored.colorVision).toBe('red-green');
  });

  it('merges a settings patch with concurrent site changes', async () => {
    let stored: TypeCheckSettings = DEFAULT_SETTINGS;
    storage.loadSettings.mockImplementation(async () => stored);
    storage.saveSettings.mockImplementation(async (settings) => {
      stored = settings;
    });

    const { handleRequest } = await import('../entrypoints/background');
    const [updateResponse, siteResponse] = await Promise.all([
      handleRequest({ type: 'settings:update', patch: { enabled: false } }),
      handleRequest({ type: 'site:set-enabled', hostname: 'example.com', enabled: false }),
    ]);

    expect(updateResponse).toEqual({ ok: true, settings: { ...DEFAULT_SETTINGS, enabled: false } });
    expect(siteResponse).toEqual({
      ok: true,
      settings: { ...DEFAULT_SETTINGS, enabled: false, disabledSites: ['example.com'] },
    });
    expect(stored).toEqual({ ...DEFAULT_SETTINGS, enabled: false, disabledSites: ['example.com'] });
  });

  it('keeps reported errors and asks the reporting tab how checking went', async () => {
    storage.loadSettings.mockResolvedValue(DEFAULT_SETTINGS);
    storage.recordRecentError.mockResolvedValue(undefined);
    storage.loadRecentErrors.mockResolvedValue([
      { at: '2026-10-11T00:00:00.000Z', where: 'page', message: 'Grammar checker failed: out of memory' },
    ]);
    tabs.sendMessage.mockResolvedValue({
      hostname: 'github.com', editor: 'textarea', checker: 'ready', lastCheckMs: 31, underlines: 2,
    });
    const { browser } = await import('wxt/browser');
    vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: '1.1.0' } as never);
    vi.mocked(browser.runtime.getPlatformInfo).mockResolvedValue({ os: 'win' } as never);

    const { handleRequest } = await import('../entrypoints/background');
    expect(await handleRequest({ type: 'error:report', message: 'Grammar checker failed: out of memory' }))
      .toEqual({ ok: true });
    expect(storage.recordRecentError).toHaveBeenCalledWith('page', 'Grammar checker failed: out of memory');

    const response = await handleRequest({ type: 'diagnostics:get', hostname: 'github.com', tabId: 7, webAssemblyAvailable: true });
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'page:status' });
    if (!response.ok || !('diagnostics' in response)) throw new Error('Expected diagnostics.');
    expect(response.diagnostics.site).toEqual({
      hostname: 'github.com', on: true, page: { editor: 'textarea', checker: 'ready', lastCheckMs: 31, underlines: 2 },
    });
    expect(response.diagnostics.recentErrors).toHaveLength(1);
  });
});
