import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { EMPTY_WORD_PAIRS, parseWordPairs } from '#/engines/word-pairs';
import { findConfusedWords } from '#/engines/confused-words';
import { lintSupplementalGrammar } from '#/engines/grammar-rules';

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 128) {
    bytes.push((rest & 127) | 128);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return bytes;
}

function u32(value: number): number[] {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

// The layout scripts/context-table.mjs writes: vocabulary "a", "b", "c" with pairs a→b (count byte 30,
// about 8) and a→c (byte 100, about 1,024), and c→a (byte 50, about 32).
function sampleTable(): Uint8Array {
  const vocabulary = [...Buffer.from('a\nb\nc', 'latin1')];
  return new Uint8Array([
    ...Buffer.from('WWP1'), ...u32(vocabulary.length), ...vocabulary, 200, 60, 90,
    ...u32(3), ...u32(2),
    ...varint(0), ...varint(2), ...varint(1), 30, ...varint(1), 100,
    ...varint(2), ...varint(1), ...varint(0), 50,
  ]);
}

describe('word pairs', () => {
  it('reads counts back from the packed layout', () => {
    const pairs = parseWordPairs(sampleTable());
    expect(pairs.wordCount('a')).toBe(1_048_576);
    expect(pairs.wordCount('b')).toBe(64);
    expect(pairs.wordCount('zzz')).toBe(0);
    expect(pairs.pairCount('a', 'b')).toBe(8);
    expect(pairs.pairCount('a', 'c')).toBe(1024);
    expect(pairs.pairCount('c', 'a')).toBe(32);
    expect(pairs.pairCount('b', 'a')).toBe(0);
    expect(pairs.pairCount('b', 'c')).toBe(0);
    expect(pairs.pairCount('a', 'zzz')).toBe(0);
  });

  it('rejects data with another layout', () => {
    expect(() => parseWordPairs(new Uint8Array(32))).toThrow(TypeError);
  });

  it('knows nothing when empty', () => {
    expect(EMPTY_WORD_PAIRS.wordCount('the')).toBe(0);
    expect(EMPTY_WORD_PAIRS.pairCount('of', 'the')).toBe(0);
  });
});

describe('bundled word pairs and confused words', async () => {
  const pairs = parseWordPairs(new Uint8Array(await readFile('public/spelling/pairs.bin')));

  it('ships common news pairs', () => {
    expect(pairs.wordCount('the')).toBeGreaterThan(1_000_000);
    expect(pairs.pairCount('of', 'the')).toBeGreaterThan(100_000);
    expect(pairs.pairCount('form', 'of')).toBeGreaterThan(pairs.pairCount('from', 'of') * 20);
  });

  it.each([
    ['I got a letter form my friend.', 'form', 'from'],
    ['She has bean to the shop.', 'bean', 'been'],
  ])('flags a real word whose neighbours belong to another: %s', (text, original, replacement) => {
    expect(findConfusedWords(text, pairs)).toEqual([expect.objectContaining({ original, replacement })]);
    const issue = lintSupplementalGrammar(text, undefined, pairs).find((item) => item.ruleId === 'ConfusedWord');
    expect(issue?.originalText).toBe(original);
    expect(issue?.replacements).toEqual([replacement]);
  });

  it.each([
    'Please fill in the form of the application.',
    'He came from the shop.',
    'We ate dinner at home and then went out.',
    'I have been to the shop.',
    'The new car is faster than the old one.',
    'Form follows function.',
    'In twenty years there will be fewer cars in use than there are today.',
  ])('leaves a word that fits its neighbours alone: %s', (text) => {
    expect(findConfusedWords(text, pairs)).toEqual([]);
  });

  it('does not pair words across punctuation or sentence ends', () => {
    expect(findConfusedWords('I got a letter, form my friend.', pairs)).toEqual([]);
    expect(findConfusedWords('It took its final form. My friend liked it.', pairs)).toEqual([]);
  });

  it('does nothing without pair data', () => {
    expect(findConfusedWords('I got a letter form my friend.', EMPTY_WORD_PAIRS)).toEqual([]);
  });
});
