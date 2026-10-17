import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CUSTOM_UNDERLINES, type TypeCheckSettings } from '#/core/settings';
import { localDay } from '#/core/typing-stats';

const settings: TypeCheckSettings = Object.freeze({
  enabled: true,
  dialect: 'american' as const,
  disabledSites: Object.freeze([]),
  dictionary: Object.freeze([]),
  ignoredIssueHashes: Object.freeze([]),
  googleDocsWarningDismissed: false,
  colorVision: 'standard',
  customUnderlines: DEFAULT_CUSTOM_UNDERLINES,
  applyShortcut: 'alt',
  ignoreCapitals: true,
  typingStats: true,
  fixEffect: 'waves',
});

const sendMessage = vi.fn();
const query = vi.fn();
const storageGet = vi.fn();

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage,
      getURL: (path: string) => `chrome-extension://typecheck${path}`,
    },
    tabs: { query, create: vi.fn() },
    storage: { local: { get: storageGet } },
  },
}));

const updateSettings = vi.fn();

vi.mock('#/ui/settings-update', () => ({ updateSettings }));

// Waits until the popup has either loaded its settings or reported that it could not.
async function renderPopup(): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>';
  await import('../entrypoints/popup/main');
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await vi.waitFor(() => {
    const text = document.body.textContent ?? '';
    expect(text.includes('Corrections') || text.includes('Background unavailable')).toBe(true);
  });
}

describe('popup UI', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    query.mockResolvedValue([{ url: 'https://example.com/editor' }]);
    storageGet.mockResolvedValue({});
  });

  it('shows a failed load and retries it', async () => {
    sendMessage
      .mockRejectedValueOnce(new Error('Background unavailable'))
      .mockResolvedValueOnce({ ok: true, settings });

    await renderPopup();

    expect(document.body.textContent).toContain('Background unavailable');
    const retry = document.querySelector<HTMLButtonElement>('button[aria-label="Retry loading settings"]');
    expect(retry).not.toBeNull();

    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Corrections');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('shows saving feedback and locks conflicting controls until a save completes', async () => {
    let resolveSave: ((value: TypeCheckSettings) => void) | undefined;
    sendMessage.mockResolvedValueOnce({ ok: true, settings });
    updateSettings.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));

    await renderPopup();
    const globalToggle = document.querySelector<HTMLButtonElement>('[aria-label="Corrections"]');
    const siteToggle = document.querySelector<HTMLButtonElement>('[aria-label^="Check "], [aria-label="Unavailable on this website"]');

    await act(async () => {
      globalToggle?.click();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(document.body.textContent).toContain('Saving…'));
    expect(globalToggle?.disabled).toBe(true);
    expect(siteToggle?.disabled).toBe(true);
    expect(updateSettings).toHaveBeenLastCalledWith(settings, expect.objectContaining({ enabled: false }));

    await act(async () => {
      resolveSave?.({ ...settings, enabled: false });
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Turned off.');
    expect(globalToggle?.disabled).toBe(false);
  });

  it('shows typing speed and accuracy, and hides them when turned off', async () => {
    storageGet.mockResolvedValue({
      'typecheck.typing-stats.v1': { day: localDay(), characters: 1000, typingMs: 240_000, mistakes: 10 },
    });
    sendMessage.mockResolvedValueOnce({ ok: true, settings });
    await renderPopup();
    expect(document.querySelector('[data-testid="today-wpm"]')?.textContent).toBe('50');
    expect(document.querySelector('[data-testid="today-accuracy"]')?.textContent).toBe('95%');
    expect(document.querySelector('[data-testid="dialect"]')).toBeNull();

    vi.resetModules();
    sendMessage.mockResolvedValueOnce({ ok: true, settings: { ...settings, typingStats: false } });
    await renderPopup();
    expect(document.querySelector('[data-testid="typing-today"]')).toBeNull();
  });

  it('reports browser-restricted pages as unavailable without claiming checker health', async () => {
    query.mockResolvedValueOnce([{ url: 'chrome://settings' }]);
    sendMessage.mockResolvedValueOnce({ ok: true, settings });

    await renderPopup();

    expect(document.querySelector('[data-testid="page-status"]')?.textContent)
      .toContain('browser-restricted');
    expect(document.querySelector<HTMLButtonElement>('[aria-label^="Check "], [aria-label="Unavailable on this website"]')?.disabled).toBe(true);
    expect(document.body.textContent).not.toContain('checker is available');
  });

  it('prioritizes the global-off preference over the site preference', async () => {
    const globallyOff: TypeCheckSettings = { ...settings, enabled: false };
    sendMessage.mockResolvedValueOnce({ ok: true, settings: globallyOff });

    await renderPopup();

    const siteToggle = document.querySelector<HTMLButtonElement>('[aria-label^="Check "], [aria-label="Unavailable on this website"]');
    expect(siteToggle?.disabled).toBe(true);
    expect(document.querySelector('[data-testid="page-status"]')?.textContent)
      .toBe('Off everywhere. Turn on Corrections to check this site.');
  });

  it('announces a failed save and unlocks controls', async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, settings });
    updateSettings.mockRejectedValueOnce(new Error('Storage is unavailable'));

    await renderPopup();
    const globalToggle = document.querySelector<HTMLButtonElement>('[aria-label="Corrections"]');

    await act(async () => {
      globalToggle?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('Storage is unavailable');
    });
    expect(globalToggle?.disabled).toBe(false);
  });

  it('describes the site status plainly and shows the privacy promise once', async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, settings });

    await renderPopup();

    expect(document.querySelector('[data-testid="page-status"]')?.textContent)
      .toBe('Checking text boxes on this site.');
    expect(document.body.textContent?.match(/Your writing stays on this device/gu)).toHaveLength(1);
    expect(document.body.textContent).not.toContain('English · american');
  });

  it('describes a site that is turned off', async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, settings: { ...settings, disabledSites: ['example.com'] } });

    await renderPopup();

    expect(document.querySelector('[data-testid="page-status"]')?.textContent).toBe('Off on this site.');
  });

  it('flags online office editors as a known issue', async () => {
    query.mockResolvedValueOnce([{ url: 'https://docs.google.com/spreadsheets/d/1' }]);
    sendMessage.mockResolvedValueOnce({ ok: true, settings });

    await renderPopup();

    expect(document.querySelector('[data-testid="page-status"]')?.textContent)
      .toBe('Known issue: this site draws its own editor, so Wordwarden cannot read or fix its text.');
    expect(document.body.textContent).toContain('docs.google.com');
  });
});
