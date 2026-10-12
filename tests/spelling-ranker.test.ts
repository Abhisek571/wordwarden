import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import american from 'dictionary-en';
import australian from 'dictionary-en-au';
import canadian from 'dictionary-en-ca';
import british from 'dictionary-en-gb';
import subtlex from 'subtlex-word-frequencies';
import type { EnglishDialect } from '#/core/types';
import { DELETION, DOUBLE_DROP, SUBSTITUTION } from '#/engines/edit-costs';
import { phoneticKey } from '#/engines/phonetic-key';
import {
  createSpellingRankerFromData,
  rankIssueReplacements,
} from '#/engines/spelling-ranker';
import { parseWordPairs } from '#/engines/word-pairs';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const weight = (typed: string, meant: string): number => SUBSTITUTION[LETTERS.indexOf(typed)]?.[LETTERS.indexOf(meant)] ?? 0;

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

  it.each([
    ['becos', 'because'],
    ['skool', 'school'],
    ['nite', 'night'],
    ['frends', 'friends'],
    ['aterny', 'attorney'],
  ])('ranks the word that sounds right first: %s', (token, expected) => {
    expect(ranker.rank(token, [])[0]).toBe(expected);
  });

  it('keeps a one-letter slip ahead of a word that merely sounds alike', () => {
    expect(ranker.rank('quater', [])[0]).toBe('quarter');
    expect(ranker.rank('woul', [])[0]).toBe('would');
    expect(ranker.rank("don;t", [])[0]).toBe("don't");
  });

  it('prefers the word whose dropped double letter is a common slip', () => {
    expect(ranker.rank('leter', [])[0]).toBe('letter');
    expect(ranker.rank('comittee', [])[0]).toBe('committee');
  });
});

describe('learned slip costs', () => {
  it('learned that e and a, c and s are confused and z and a are not', () => {
    expect(weight('e', 'a')).toBeGreaterThanOrEqual(20);
    expect(weight('a', 'e')).toBeGreaterThanOrEqual(20);
    expect(weight('c', 's')).toBeGreaterThanOrEqual(20);
    expect(weight('z', 'a')).toBeLessThanOrEqual(-20);
    expect(weight('q', 'w')).toBeLessThanOrEqual(-20);
    expect(DOUBLE_DROP[LETTERS.indexOf('l')]).toBeGreaterThan(DELETION[LETTERS.indexOf('l')] ?? 0);
  });

  it('ranks the likelier letter slip first among equally common words', () => {
    const ranker = createSpellingRankerFromData(
      { aff: 'SET UTF-8', dic: '1\nhello' },
      [{ word: 'pip', count: 1000 }, { word: 'zip', count: 1000 }, { word: 'bat', count: 1000 }, { word: 'sat', count: 1000 }],
      [],
    );
    // "s" is often typed for "z" and rarely for "p"; "z" is rarely typed for "b".
    expect(ranker.rank('sip', ['pip', 'zip'])[0]).toBe('zip');
    expect(ranker.rank('zat', ['bat', 'sat'])[0]).toBe('sat');
  });
});

describe('local spelling ranker with word-pair context', async () => {
  const pairs = parseWordPairs(new Uint8Array(await readFile('public/spelling/pairs.bin')));
  const ranker = createSpellingRankerFromData(dictionaryText(american), subtlex, Object.freeze([]), pairs);

  it('lets the words either side pick between equally close fixes', () => {
    expect(ranker.rank('fom', [], { previous: 'the', next: 'of' })[0]).toBe('form');
    expect(ranker.rank('fom', [], { previous: 'came', next: 'the' })[0]).toBe('from');
    expect(ranker.rank('chese', [], { previous: 'eat', next: 'and' })[0]).toBe('cheese');
    expect(ranker.rank('chese', [], { previous: 'of', next: 'days' })[0]).toBe('these');
  });

  it('ranks as before without neighbours', () => {
    expect(ranker.rank('teh', ['ten', 'Th', 'tea'])[0]).toBe('the');
    expect(ranker.rank('becos', [])[0]).toBe('because');
  });

  it('passes the context through for spelling issues only', () => {
    expect(rankIssueReplacements('spelling', 'fom', [], ranker, { previous: 'came', next: 'the' })[0]).toBe('from');
    expect(rankIssueReplacements('grammar', 'is', ['are', 'were'], ranker, { previous: 'they' })).toEqual(['are', 'were']);
  });
});

describe('phonetic key', () => {
  it.each([
    ['phone', 'fone'],
    ['because', 'becos'],
    ['school', 'skool'],
    ['night', 'nite'],
    ['when', 'wen'],
    ['said', 'sed'],
    ['know', 'no'],
    ['wrong', 'rong'],
    ['nation', 'nashun'],
    ['accident', 'axident'],
    ['thumb', 'thum'],
    ['letter', 'leter'],
  ])('gives %s and %s the same key', (word, misspelling) => {
    expect(phoneticKey(misspelling)).toBe(phoneticKey(word));
  });

  it('keeps words that sound different apart', () => {
    expect(phoneticKey('the')).not.toBe(phoneticKey('tea'));
    expect(phoneticKey('words')).not.toBe(phoneticKey('wars'));
    expect(phoneticKey('cat')).not.toBe(phoneticKey('cash'));
  });

  it('ignores case and punctuation and keeps a leading vowel', () => {
    expect(phoneticKey("Don't")).toBe('TNT');
    expect(phoneticKey('about')).toBe('ABT');
    expect(phoneticKey('')).toBe('');
  });
});
