import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '#/core/settings';
import { exportSettings, parseSettingsImport } from '#/core/settings-transfer';

const saved = Object.freeze({
  ...DEFAULT_SETTINGS,
  dialect: 'british',
  dictionary: Object.freeze(['Wordwarden']),
  disabledSites: Object.freeze(['example.com', 'twitch.tv']),
} as const);

describe('settings transfer', () => {
  it('round-trips every setting through an exported file', () => {
    const preview = parseSettingsImport(exportSettings(saved), DEFAULT_SETTINGS);
    expect(preview.settings).toEqual(saved);
    expect(preview.summary).toBe('Replace your current settings with this file? It has 1 dictionary word and 2 turned-off websites.');
  });

  it('merges a plain word list into the current dictionary and keeps everything else', () => {
    const preview = parseSettingsImport('Harper\nwordwarden\n', saved);
    expect(preview.settings).toEqual({ ...saved, dictionary: ['Harper', 'Wordwarden'] });
    expect(preview.summary).toBe('Merge 1 new word with the current dictionary?');
  });

  it('rejects files that are not Wordwarden settings or come from a newer version', () => {
    expect(() => parseSettingsImport('{ broken', saved)).toThrow('not a Wordwarden settings file');
    expect(() => parseSettingsImport('{"settings":{}}', saved)).toThrow('not a Wordwarden settings file');
    expect(() => parseSettingsImport('{"format":"wordwarden-settings","version":2,"settings":{}}', saved)).toThrow('newer Wordwarden');
  });

  it('fills in defaults for anything missing or invalid in the file', () => {
    const preview = parseSettingsImport('{"format":"wordwarden-settings","version":1,"settings":{"dialect":"klingon","enabled":false}}', saved);
    expect(preview.settings).toEqual({ ...DEFAULT_SETTINGS, enabled: false });
  });
});
