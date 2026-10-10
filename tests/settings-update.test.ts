import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '#/core/settings';

const sendMessage = vi.hoisted(() => vi.fn());

vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));

beforeEach(() => {
  sendMessage.mockReset();
});

describe('updateSettings', () => {
  it('returns the current settings without sending a request when nothing changed', async () => {
    const { updateSettings } = await import('#/ui/settings-update');

    await expect(updateSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).resolves.toBe(DEFAULT_SETTINGS);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends only changed fields and returns the authoritative stored settings', async () => {
    const next = { ...DEFAULT_SETTINGS, enabled: false, dialect: 'british' as const };
    const stored = { ...next, disabledSites: ['example.com'] };
    sendMessage.mockResolvedValue({ ok: true, settings: stored });
    const { updateSettings } = await import('#/ui/settings-update');

    await expect(updateSettings(DEFAULT_SETTINGS, next)).resolves.toBe(stored);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings:update',
      patch: { enabled: false, dialect: 'british' },
    });
  });

  it('includes the current array values as conflict bases for changed array fields', async () => {
    const current = {
      ...DEFAULT_SETTINGS,
      dictionary: ['existing'],
      ignoredIssueHashes: ['old-hash'],
      disabledSites: ['old.example'],
    };
    const next = {
      ...current,
      dictionary: ['existing', 'added'],
      ignoredIssueHashes: ['new-hash'],
      disabledSites: ['new.example'],
    };
    sendMessage.mockResolvedValue({ ok: true, settings: next });
    const { updateSettings } = await import('#/ui/settings-update');

    await expect(updateSettings(current, next)).resolves.toBe(next);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings:update',
      patch: {
        dictionary: ['existing', 'added'],
        ignoredIssueHashes: ['new-hash'],
        disabledSites: ['new.example'],
      },
      base: {
        dictionary: ['existing'],
        ignoredIssueHashes: ['old-hash'],
        disabledSites: ['old.example'],
      },
    });
  });

  it('rejects an invalid response instead of accepting unvalidated settings', async () => {
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: false } });
    const { updateSettings } = await import('#/ui/settings-update');

    await expect(updateSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, enabled: false }))
      .rejects.toThrow('Invalid settings update response.');
  });
});
