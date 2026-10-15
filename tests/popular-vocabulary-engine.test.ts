// @vitest-environment node
import { describe, expect, it } from 'vitest';
import american from 'dictionary-en';
import australian from 'dictionary-en-au';
import canadian from 'dictionary-en-ca';
import british from 'dictionary-en-gb';
import frequencies from 'subtlex-word-frequencies';
import { wordwardenCoreWasmUrl } from './helpers/wordwarden-core-wasm';
import type { EnglishDialect, WritingIssue } from '#/core/types';
import { POPULAR_VOCABULARY } from '#/core/popular-vocabulary';
import { createWordwardenCore, type WordwardenCore } from '#/engines/wordwarden-core';
import { createSpellingRankerFromData } from '#/engines/spelling-ranker';
import { readBundledExtraWords } from './helpers/production-engine';

const decoder = new TextDecoder();
const dictionaries = Object.freeze({
  american,
  australian,
  canadian,
  british,
} satisfies Readonly<Record<EnglishDialect, typeof american>>);

function spellingIssuesFor(issues: readonly WritingIssue[], text: string): readonly WritingIssue[] {
  return issues.filter((issue) => issue.category === 'spelling' && issue.originalText === text);
}

function spellingIssuesOverlapping(
  issues: readonly WritingIssue[],
  start: number,
  end: number,
): readonly WritingIssue[] {
  return issues.filter((issue) => (
    issue.category === 'spelling' && issue.range.start < end && issue.range.end > start
  ));
}

async function createRuntimeEngine(dialect: EnglishDialect): Promise<WordwardenCore> {
  const dictionary = dictionaries[dialect];
  const engine = createWordwardenCore(Object.freeze({
    wasmUrl: wordwardenCoreWasmUrl,
    createSpellingRanker: async (_dialect, words) => createSpellingRankerFromData(
      Object.freeze({ aff: decoder.decode(dictionary.aff), dic: decoder.decode(dictionary.dic) }),
      frequencies,
      words,
    ),
    loadExtraWords: readBundledExtraWords,
  }));
  await engine.setup(dialect, Object.freeze([]));
  return engine;
}

describe('the engine between checks', () => {
  it('gives the same findings again for unchanged text and after a change elsewhere in it', async () => {
    const engine = await createRuntimeEngine('american');
    try {
      const first = 'I recieve alot of questions about hiking, so here is my advice. Their is no need for expensive gear when you start. ';
      const second = 'Always check the weather befor you leave, and tell a friend were you are going. Me and my friend was going to the mountains.';
      const before = await engine.lint(first + second);
      expect(await engine.lint(first + second)).toEqual(before);
      // Changing the end leaves the findings at the start as they were.
      const changed = await engine.lint(`${first}${second} We walked for nearly two hour.`);
      expect(changed.filter((issue) => issue.range.end <= first.length))
        .toEqual(before.filter((issue) => issue.range.end <= first.length));
    } finally {
      await engine.dispose();
    }
  });

  it('accepts words added to the dictionary as if they had been there from the start', async () => {
    const engine = await createRuntimeEngine('american');
    const fresh = createWordwardenCore(Object.freeze({
      wasmUrl: wordwardenCoreWasmUrl,
      createSpellingRanker: async (_dialect, words) => createSpellingRankerFromData(
        Object.freeze({ aff: decoder.decode(american.aff), dic: decoder.decode(american.dic) }),
        frequencies,
        words,
      ),
      loadExtraWords: readBundledExtraWords,
    }));
    await fresh.setup('american', Object.freeze(['Zorbleton', 'Quindrel']));
    try {
      const text = 'Zorbleton met Quindrel and Zorbletn at the stadion.';
      expect(spellingIssuesFor(await engine.lint(text), 'Zorbleton')).toHaveLength(1);
      await engine.addWords(['Zorbleton', 'Quindrel']);
      const added = await engine.lint(text);
      expect(spellingIssuesFor(added, 'Zorbleton')).toEqual([]);
      expect(spellingIssuesFor(added, 'Zorbletn')[0]?.replacements).toContain('Zorbleton');
      expect(added).toEqual(await fresh.lint(text));
    } finally {
      await Promise.all([engine.dispose(), fresh.dispose()]);
    }
  });
});

describe('popular vocabulary in the actual core runtime', () => {
  for (const dialect of Object.keys(dictionaries) as EnglishDialect[]) {
    it(`recognizes brands and retains nearby typo detection in ${dialect} English`, async () => {
      const engine = await createRuntimeEngine(dialect);
      try {
        const issues = await engine.lint("openai and SPACEX shipped. OpenAI's and SpaceX’s launches worked. OpenAl and SpaceXX fail. Wrogn stays wrong.");
        expect(spellingIssuesFor(issues, 'openai')).toEqual([]);
        expect(spellingIssuesFor(issues, 'SPACEX')).toEqual([]);
        const straightPossessiveStart = "openai and SPACEX shipped. ".length;
        const curlyPossessiveStart = straightPossessiveStart + "OpenAI's and ".length;
        expect(spellingIssuesOverlapping(issues, straightPossessiveStart, straightPossessiveStart + "OpenAI's".length)).toEqual([]);
        expect(spellingIssuesOverlapping(issues, curlyPossessiveStart, curlyPossessiveStart + 'SpaceX’s'.length)).toEqual([]);
        expect(spellingIssuesFor(issues, 'OpenAl')[0]?.replacements).toContain('OpenAI');
        expect(spellingIssuesFor(issues, 'SpaceXX')[0]?.replacements).toContain('SpaceX');
        expect(spellingIssuesFor(issues, 'Wrogn')).toHaveLength(1);
      } finally {
        await engine.dispose();
      }
    });
  }

  it('does not make ordinary ambiguous words compulsory brands', async () => {
    const engine = await createRuntimeEngine('american');
    try {
      const issues = await engine.lint('I ate an apple and studied metaphysics.');
      expect(spellingIssuesFor(issues, 'apple')).toEqual([]);
      expect(spellingIssuesFor(issues, 'metaphysics')).toEqual([]);
    } finally {
      await engine.dispose();
    }
  });

  it('recognizes every curated entry in lowercase', async () => {
    const engine = await createRuntimeEngine('american');
    try {
      const text = POPULAR_VOCABULARY.map((word) => word.toLocaleLowerCase('en')).join(' ');
      expect((await engine.lint(text)).filter((issue) => issue.category === 'spelling')).toEqual([]);
    } finally {
      await engine.dispose();
    }
  });

  it('does not retain a personal word after setup resets the personal dictionary', async () => {
    const engine = await createRuntimeEngine('american');
    try {
      await engine.setup('american', Object.freeze(['PersonalOnlyTerm']));
      expect(spellingIssuesFor(await engine.lint('PersonalOnlyTerm'), 'PersonalOnlyTerm')).toEqual([]);

      await engine.setup('american', Object.freeze([]));
      expect(spellingIssuesFor(await engine.lint('PersonalOnlyTerm'), 'PersonalOnlyTerm')).toHaveLength(1);
    } finally {
      await engine.dispose();
    }
  });
});
