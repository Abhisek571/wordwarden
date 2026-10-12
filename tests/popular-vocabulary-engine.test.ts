// @vitest-environment node
import { describe, expect, it } from 'vitest';
import american from 'dictionary-en';
import australian from 'dictionary-en-au';
import canadian from 'dictionary-en-ca';
import british from 'dictionary-en-gb';
import frequencies from 'subtlex-word-frequencies';
import { binaryInlined } from 'harper.js/binaryInlined';
import type { EnglishDialect, WritingIssue } from '#/core/types';
import { POPULAR_VOCABULARY } from '#/core/popular-vocabulary';
import { createHarperEngine, type HarperEngine } from '#/engines/harper-engine';
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

async function createRuntimeEngine(dialect: EnglishDialect): Promise<HarperEngine> {
  const dictionary = dictionaries[dialect];
  const engine = createHarperEngine(Object.freeze({
    wasmUrl: binaryInlined.url.toString(),
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

describe('popular vocabulary in the actual Harper runtime', () => {
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
