import { describe, expect, it } from 'vitest';
import american from 'dictionary-en';
import australian from 'dictionary-en-au';
import canadian from 'dictionary-en-ca';
import british from 'dictionary-en-gb';
import subtlex from 'subtlex-word-frequencies';
import type { EnglishDialect } from '#/core/types';
import {
  createSpellingRankerFromData,
  rankIssueReplacements,
} from '#/engines/spelling-ranker';

const decoder = new TextDecoder();
const frequencies = Object.freeze([
  Object.freeze({ word: 'words', count: 10_000 }),
  Object.freeze({ word: 'works', count: 8_000 }),
  Object.freeze({ word: 'wars', count: 500 }),
  Object.freeze({ word: 'woes', count: 400 }),
  Object.freeze({ word: 'wogs', count: 1 }),
  Object.freeze({ word: 'TypeCheck', count: 100 }),
]);

const dictionaries = Object.freeze({
  american,
  australian,
  canadian,
  british,
} satisfies Readonly<Record<EnglishDialect, typeof american>>);

function dictionaryText(dictionary: typeof american): Readonly<{ aff: string; dic: string }> {
  return Object.freeze({
    aff: decoder.decode(dictionary.aff),
    dic: decoder.decode(dictionary.dic),
  });
}

describe('local spelling ranker', () => {
  for (const [dialect, dictionary] of Object.entries(dictionaries)) {
    it(`ranks words first for wors in ${dialect} English`, () => {
      const ranker = createSpellingRankerFromData(
        dictionaryText(dictionary),
        frequencies,
        Object.freeze([]),
      );
      const ranked = ranker.rank('wors', Object.freeze(['wars', 'woes', 'wogs', 'wars']));
      expect(ranked[0]).toBe('words');
      expect(ranked).toHaveLength(3);
      expect(new Set(ranked).size).toBe(ranked.length);
    });
  }

  it('preserves title and uppercase input casing', () => {
    const ranker = createSpellingRankerFromData(
      dictionaryText(american),
      frequencies,
      Object.freeze([]),
    );
    expect(ranker.rank('Wors', Object.freeze([]))[0]).toBe('Words');
    expect(ranker.rank('WORS', Object.freeze([]))[0]).toBe('WORDS');
  });

  it('preserves uppercase input for ordinary titlecase Harper candidates', () => {
    const ranker = createSpellingRankerFromData(
      { aff: 'SET UTF-8', dic: '1\nhello' }, [], [],
    );
    expect(ranker.rank('WORS', ['Words'])).toContain('WORDS');
  });

  it('uses personal words as spelling candidates', () => {
    const ranker = createSpellingRankerFromData(
      dictionaryText(american),
      frequencies,
      Object.freeze(['TypeCheck']),
    );
    expect(ranker.rank('TypeChek', Object.freeze([]))).toContain('TypeCheck');
  });

  it('keeps mixed-case canonical candidates despite uppercase input', () => {
    const ranker = createSpellingRankerFromData(
      dictionaryText(american),
      frequencies,
      Object.freeze(['OpenAI']),
    );
    expect(ranker.rank('OPENAL', Object.freeze([]))).toContain('OpenAI');
  });

  it('offers personal and bundled words only for near misses', () => {
    const ranker = createSpellingRankerFromData(
      dictionaryText(american),
      frequencies,
      Object.freeze(['ChatGPT', 'Docker', 'OpenAI']),
    );
    const suggestions = ranker.rank('Chicugta', Object.freeze([]));
    expect(suggestions).not.toContain('ChatGPT');
    expect(suggestions).not.toContain('Docker');
    expect(ranker.rank('Dokcer', Object.freeze([]))).toContain('Docker');
  });

  it('does not let bundled brand prefixes suppress sentence punctuation', () => {
    const ranker = createSpellingRankerFromData(
      { aff: 'SET UTF-8', dic: '1\nhello' }, [], ['SpaceX', 'ChatGPT', 'PersonalTerm'],
    );
    expect(ranker.hasPrefixCompletion('space')).toBe(false);
    expect(ranker.hasPrefixCompletion('chat')).toBe(false);
    expect(ranker.hasPrefixCompletion('personal')).toBe(true);
  });

  it('identifies strict spelling prefix completions', () => {
    const ranker = createSpellingRankerFromData(
      dictionaryText(american),
      Object.freeze([
        Object.freeze({ word: 'const', count: 12_000 }),
        Object.freeze({ word: 'constant', count: 10_000 }),
      ]),
      Object.freeze([]),
    );

    expect(ranker.hasPrefixCompletion('const')).toBe(true);
    expect(ranker.hasPrefixCompletion('constant')).toBe(false);
  });

  it('treats a common finished word as complete despite a rare longer form', () => {
    const ranker = createSpellingRankerFromData(
      dictionaryText(american),
      Object.freeze([
        Object.freeze({ word: 'tomorrow', count: 20_000 }),
        Object.freeze({ word: 'tomorrows', count: 40 }),
      ]),
      Object.freeze([]),
    );
    expect(ranker.hasPrefixCompletion('tomorrow')).toBe(false);
    expect(ranker.hasPrefixCompletion('tomor')).toBe(true);
  });

  it('keeps Harper grammar replacements in their original order', () => {
    const ranker = createSpellingRankerFromData(
      dictionaryText(american),
      frequencies,
      Object.freeze([]),
    );
    const harperCandidates = Object.freeze(['are', 'were']);
    expect(rankIssueReplacements('grammar', 'is', harperCandidates, ranker)).toEqual([
      'are',
      'were',
    ]);
  });
});

describe('local spelling ranker with bundled frequencies', () => {
  const ranker = createSpellingRankerFromData(dictionaryText(american), subtlex, Object.freeze([]));

  it.each([
    ['teh', ['ten', 'Th', 'tea'], 'the'],
    ['aftre', ['afire', 'afore', 'after'], 'after'],
    ['chagned', ['chained', 'changed', 'canned'], 'changed'],
    ['tset', ['set', 'Tet', 'the'], 'test'],
    ['Whne', ['Wine', 'Whee', 'Whine'], 'When'],
    ['daat', ['dart', 'daft', 'DAT'], 'data'],
    ['recieve', [], 'receive'],
  ])('ranks a swapped-letter fix first: %s', (token, harper, expected) => {
    expect(ranker.rank(token, harper)[0]).toBe(expected);
  });

  it.each([
    ['workd', ['work', 'world', 'word'], 'worked'],
    ['dely', ['rely', 'duly', 'deny'], 'delay'],
  ])('offers dictionary words one typo away: %s', (token, harper, expected) => {
    expect(ranker.rank(token, harper)).toContain(expected);
  });

  it('keeps the most common one-typo word on the card', () => {
    const suggestions = ranker.rank('uo', ['ufo', 'quo', 'duo']);
    expect(suggestions).toHaveLength(3);
    expect(suggestions).toContain('up');
  });

  it('does not offer short capitalized fragments for a lowercase typo', () => {
    expect(ranker.rank('teh', ['ten', 'Th', 'tea'])).not.toContain('Th');
  });
});
