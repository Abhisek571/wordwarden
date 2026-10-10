import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CUSTOM_UNDERLINES } from '#/core/settings';

const runtimeRequest = vi.hoisted(() => vi.fn());
const updateSettings = vi.hoisted(() => vi.fn());
vi.mock('wxt/browser', () => ({ browser: { tabs: { create: vi.fn() } } }));
vi.mock('#/ui/runtime', () => ({ runtimeRequest }));
vi.mock('#/ui/settings-update', () => ({ updateSettings }));

afterEach(() => {
  vi.resetModules();
  runtimeRequest.mockReset();
  updateSettings.mockReset();
  document.body.replaceChildren();
});

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 500;
  let failure: unknown;
  do {
    try { assertion(); return; } catch (error) { failure = error; }
    await new Promise((resolve) => setTimeout(resolve, 1));
  } while (Date.now() < deadline);
  throw failure;
}

async function renderOptions(): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>';
  await import('../entrypoints/options/main');
  await waitFor(() => expect(document.querySelector('#root')?.childElementCount).toBeGreaterThan(0));
}

describe('options settings UI', () => {
  it('shows a failed settings load and retries it', async () => {
    runtimeRequest
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValue({ ok: true, settings: {
        enabled: true, dialect: 'american', disabledSites: [], dictionary: [], ignoredIssueHashes: [], googleDocsWarningDismissed: false, colorVision: 'standard', customUnderlines: DEFAULT_CUSTOM_UNDERLINES, applyShortcut: 'alt', ignoreCapitals: true,
      } });

    await renderOptions();

    await waitFor(() => expect(document.body.textContent).toContain('Storage unavailable'));
    const retry = document.querySelector<HTMLButtonElement>('[data-testid="retry-settings-load"]');
    expect(retry).not.toBeNull();
    retry?.click();
    await waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Settings'));
    expect(document.body.textContent).not.toContain('Storage unavailable');
    expect(runtimeRequest).toHaveBeenCalledTimes(2);
  });

  it('saves custom underline colours typed as RGB numbers', async () => {
    const stored = {
      enabled: true, dialect: 'american', disabledSites: [], dictionary: [], ignoredIssueHashes: [], googleDocsWarningDismissed: false, colorVision: 'standard', customUnderlines: DEFAULT_CUSTOM_UNDERLINES, applyShortcut: 'alt', ignoreCapitals: true,
    };
    runtimeRequest.mockResolvedValue({ ok: true, settings: stored });
    updateSettings.mockImplementation(async (_current, next) => next);
    await renderOptions();
    await waitFor(() => expect(document.querySelector('[data-testid="underline-spelling-green"]')).not.toBeNull());
    const green = document.querySelector<HTMLInputElement>('[data-testid="underline-spelling-green"]');
    if (green === null) throw new Error('Green input is missing.');
    expect(green.value).toBe('47');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(green, '200');
    green.dispatchEvent(new Event('input', { bubbles: true }));
    const sample = document.querySelector<HTMLElement>('[data-testid="underline-spelling"] .underline-sample');
    await waitFor(() => expect(sample?.style.borderBottom).toContain('#d3c82f'));
    document.querySelector<HTMLButtonElement>('[data-testid="apply-underlines"]')?.click();

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    const [, next] = updateSettings.mock.calls[0] as [unknown, { colorVision: string; customUnderlines: typeof DEFAULT_CUSTOM_UNDERLINES }];
    expect(next.colorVision).toBe('custom');
    expect(next.customUnderlines.spelling.color).toBe('#d3c82f');
    expect(next.customUnderlines.grammar).toEqual(DEFAULT_CUSTOM_UNDERLINES.grammar);
  });

  it('keeps an added dictionary word after a failed save', async () => {
    runtimeRequest.mockResolvedValue({ ok: true, settings: {
      enabled: true, dialect: 'american', disabledSites: [], dictionary: [], ignoredIssueHashes: [], googleDocsWarningDismissed: false, colorVision: 'standard', customUnderlines: DEFAULT_CUSTOM_UNDERLINES, applyShortcut: 'alt', ignoreCapitals: true,
    } });
    updateSettings.mockRejectedValue(new Error('Save failed'));
    await renderOptions();
    await waitFor(() => expect(document.querySelector('[data-testid="dictionary-word"]')).not.toBeNull());
    const input = document.querySelector<HTMLInputElement>('[data-testid="dictionary-word"]');
    if (input === null) throw new Error('Dictionary input is missing.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Ada');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Add word')?.click();
    await waitFor(() => expect(document.body.textContent).toContain('Save failed'));
    expect(input.value).toBe('Ada');
  });

  it('clears an actionable import preview when a later import fails', async () => {
    runtimeRequest.mockResolvedValue({ ok: true, settings: {
      enabled: true, dialect: 'american', disabledSites: [], dictionary: [], ignoredIssueHashes: [], googleDocsWarningDismissed: false, colorVision: 'standard', customUnderlines: DEFAULT_CUSTOM_UNDERLINES, applyShortcut: 'alt', ignoreCapitals: true,
    } });
    await renderOptions();
    await waitFor(() => expect(document.querySelector('[data-testid="dictionary-import"]')).not.toBeNull());
    const input = document.querySelector<HTMLInputElement>('[data-testid="dictionary-import"]');
    if (input === null) throw new Error('Dictionary import input is missing.');
    const selectFile = (file: File): void => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    selectFile(new File(['Ada'], 'dictionary.txt', { type: 'text/plain' }));
    await waitFor(() => expect(document.body.textContent).toContain('Merge 1 new word'));
    selectFile(new File(['two words'], 'invalid.txt', { type: 'text/plain' }));

    await waitFor(() => expect(document.body.textContent).toContain('Invalid dictionary word: two words'));
    expect(document.body.textContent).not.toContain('Merge 1 new word');
  });

  it('locks dictionary actions while a save is pending', async () => {
    const settings = {
      enabled: true, dialect: 'american' as const, disabledSites: [], dictionary: [], ignoredIssueHashes: [], googleDocsWarningDismissed: false, colorVision: 'standard', customUnderlines: DEFAULT_CUSTOM_UNDERLINES, applyShortcut: 'alt', ignoreCapitals: true,
    };
    runtimeRequest.mockResolvedValue({ ok: true, settings });
    let finishSave!: (saved: Omit<typeof settings, 'dictionary'> & { dictionary: string[] }) => void;
    updateSettings.mockImplementation(() => new Promise<Parameters<typeof finishSave>[0]>((resolve) => { finishSave = resolve; }));
    await renderOptions();
    await waitFor(() => expect(document.querySelector('[data-testid="dictionary-word"]')).not.toBeNull());
    const input = document.querySelector<HTMLInputElement>('[data-testid="dictionary-word"]');
    if (input === null) throw new Error('Dictionary input is missing.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Ada');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const add = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Add word');
    add?.click();

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(input.disabled).toBe(true);
    expect(add?.disabled).toBe(true);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(updateSettings).toHaveBeenCalledTimes(1);

    finishSave({ ...settings, dictionary: ['Ada'] });
    await waitFor(() => expect(input.disabled).toBe(false));
  });

  it('offers one Report issue button and a hint in the dictionary field', async () => {
    runtimeRequest.mockResolvedValue({ ok: true, settings: {
      enabled: true, dialect: 'american', disabledSites: [], dictionary: [], ignoredIssueHashes: [], googleDocsWarningDismissed: false, colorVision: 'standard', customUnderlines: DEFAULT_CUSTOM_UNDERLINES, applyShortcut: 'alt', ignoreCapitals: true,
    } });
    await renderOptions();
    await waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Settings'));
    const reportButtons = Array.from(document.querySelectorAll('button'))
      .filter((button) => button.textContent === 'Report issue');
    expect(reportButtons).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('[data-testid="dictionary-word"]')?.placeholder)
      .toBe('Add a word, e.g. a name or brand');
  });

  it('focuses the report modal, makes its background inert, and restores its opener after Escape', async () => {
    runtimeRequest.mockResolvedValue({ ok: true, settings: {
      enabled: true, dialect: 'american', disabledSites: [], dictionary: [], ignoredIssueHashes: [], googleDocsWarningDismissed: false, colorVision: 'standard', customUnderlines: DEFAULT_CUSTOM_UNDERLINES, applyShortcut: 'alt', ignoreCapitals: true,
    } });
    await renderOptions();
    await waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Settings'));
    const opener = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Report issue');
    opener?.focus();
    opener?.click();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());

    const heading = document.getElementById('report-heading');
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(document.querySelector('header.settings-header')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.settings-layout')?.hasAttribute('inert')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close diagnostic report"]');
    await waitFor(() => expect(document.activeElement).toBe(close));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    const generate = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((button) => button.textContent === 'Generate diagnostic log');
    await waitFor(() => expect(document.activeElement).toBe(generate));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
