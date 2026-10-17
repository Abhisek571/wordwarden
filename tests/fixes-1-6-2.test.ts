import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, detectDefaultDialect } from '#/core/settings';
import { mergePopularVocabulary } from '#/core/popular-vocabulary';
import { parseSettingsImport, withImportedWords } from '#/core/settings-transfer';

describe('default dialect', () => {
  it.each([
    ['en-US', 'american'], ['en-PH', 'american'], ['en-GB', 'british'], ['en-IE', 'british'], ['en-IN', 'british'],
    ['en-ZA', 'british'], ['en-SG', 'british'], ['en-AU', 'australian'], ['en-NZ', 'australian'], ['en-CA', 'canadian'],
    ['fr-FR', 'american'],
  ] as const)('%s starts in %s English', (locale, dialect) => {
    expect(detectDefaultDialect(locale)).toBe(dialect);
  });
});

describe('personal words for the engine', () => {
  it('keeps the lowercase spelling when both are added, so both are accepted', () => {
    expect(mergePopularVocabulary(['Wordwarden', 'wordwarden'])).toContain('wordwarden');
    expect(mergePopularVocabulary(['Wordwarden', 'wordwarden'])).not.toContain('Wordwarden');
    expect(mergePopularVocabulary(['Wordwarden'])).toContain('Wordwarden');
  });
});

describe('settings import', () => {
  it('refuses a settings file with no settings in it', () => {
    for (const settings of ['{}', '[]']) {
      const text = `{"format":"wordwarden-settings","version":1,"settings":${settings}}`;
      expect(() => parseSettingsImport(text, DEFAULT_SETTINGS)).toThrow('no settings');
    }
  });

  it('adds a word list to the settings as they are when the import is confirmed', () => {
    const preview = parseSettingsImport('alpha\nimported', { ...DEFAULT_SETTINGS, dictionary: ['alpha'] });
    const later = { ...DEFAULT_SETTINGS, dictionary: ['alpha', 'beta'], typingStats: false };
    const saved = withImportedWords(later, preview.addWords ?? []);
    expect(saved.dictionary).toEqual(['alpha', 'beta', 'imported']);
    expect(saved.typingStats).toBe(false);
  });
});
