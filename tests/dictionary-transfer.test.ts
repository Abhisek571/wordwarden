import { describe, expect, it } from 'vitest';
import {
  MAX_DICTIONARY_IMPORT_BYTES,
  MAX_DICTIONARY_WORDS,
  exportDictionary,
  parseDictionaryImport,
} from '#/core/dictionary-transfer';

describe('dictionary transfer', () => {
  it('exports a sorted plain-text dictionary', () => {
    expect(exportDictionary(['Zulu', 'alpha', 'Beta'])).toBe('alpha\nBeta\nZulu\n');
  });

  it('previews a deduplicated merge without replacing existing words', () => {
    expect(parseDictionaryImport('Beta\nalpha\nbeta\n', ['Alpha', 'zulu'])).toEqual({
      words: ['Alpha', 'Beta', 'zulu'],
      addedCount: 1,
    });
  });

  it('rejects invalid words before any save can occur', () => {
    expect(() => parseDictionaryImport('valid\ntwo words\n', [])).toThrow('Invalid dictionary word: two words');
  });

  it('rejects imports exceeding the byte or total word limits', () => {
    expect(() => parseDictionaryImport('a'.repeat(MAX_DICTIONARY_IMPORT_BYTES + 1), [])).toThrow('too large');
    expect(() => parseDictionaryImport(Array.from({ length: MAX_DICTIONARY_WORDS + 1 }, (_, index) => `word${index}`).join('\n'), [])).toThrow('too many');
  });
});
