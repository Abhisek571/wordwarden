import { describe, expect, it } from 'vitest';
import {
  isCapitalsWord,
  POPULAR_VOCABULARY,
  isPopularVocabularyWord,
  mergePopularVocabulary,
  popularVocabularyKeys,
} from '#/core/popular-vocabulary';

describe('popular vocabulary', () => {
  it('contains a small deterministic set of valid canonical single-token entries', () => {
    expect(POPULAR_VOCABULARY).toEqual([
      'Airbnb', 'Android', 'ChatGPT', 'Docker', 'GitHub', 'GitLab', 'GraphQL',
      'iOS', 'iPad', 'iPhone', 'Kubernetes', 'LinkedIn', 'macOS', 'MongoDB',
      'Netflix', 'OK', 'OpenAI', 'PostgreSQL', 'Shopify', 'SpaceX', 'Spotify',
      'TikTok', 'TypeScript', 'WhatsApp', 'YouTube',
    ]);
    expect(popularVocabularyKeys).toEqual([...popularVocabularyKeys].sort());
    expect(new Set(popularVocabularyKeys).size).toBe(popularVocabularyKeys.length);
    expect(POPULAR_VOCABULARY.every((word) => /^\p{L}[\p{L}\p{N}]*$/u.test(word))).toBe(true);
  });

  it('recognizes words written in capitals', () => {
    for (const word of ['SDE', 'FOMOD', "SDE's", 'SDE’s', 'MP3']) expect(isCapitalsWord(word)).toBe(true);
    for (const word of ['I', 'Serana', 'teh', 'iOS', '3D']) expect(isCapitalsWord(word)).toBe(false);
  });

  it('merges personal words without mutation and keeps curated canonical casing', () => {
    const personal = Object.freeze(['openai', 'ExampleWord', 'SPACEX']);
    const merged = mergePopularVocabulary(personal);

    expect(merged).toContain('OpenAI');
    expect(merged).toContain('SpaceX');
    expect(merged).toContain('ExampleWord');
    expect(merged.filter((word) => word.toLocaleLowerCase('en') === 'openai')).toEqual(['OpenAI']);
    expect(merged.filter((word) => word.toLocaleLowerCase('en') === 'spacex')).toEqual(['SpaceX']);
    expect(personal).toEqual(['openai', 'ExampleWord', 'SPACEX']);
    expect(Object.isFrozen(merged)).toBe(true);
  });

  it('recognizes only exact case-insensitive curated tokens', () => {
    expect(isPopularVocabularyWord('openai')).toBe(true);
    expect(isPopularVocabularyWord('SPACEX')).toBe(true);
    expect(isPopularVocabularyWord('OpenAIx')).toBe(false);
    expect(isPopularVocabularyWord('apple')).toBe(false);
  });
});
