// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WritingIssue } from '#/core/types';
import type { WordwardenCore } from '#/engines/wordwarden-core';
import { createProductionEngine } from './helpers/production-engine';

let american: WordwardenCore;

beforeAll(async () => {
  american = await createProductionEngine('american');
}, 120_000);

afterAll(async () => {
  await american.dispose();
});

async function issueAt(text: string, word: string): Promise<WritingIssue | undefined> {
  const start = text.indexOf(word);
  return (await american.lint(text)).find((issue) => issue.range.start === start && issue.range.end === start + word.length);
}

describe('spelling fixes at the start of a sentence', () => {
  it('capitalises the fix of a lowercase misspelling that starts a sentence', async () => {
    for (const [text, word] of [
      ['becuse I left early.', 'becuse'],
      ['It rained. becuse of that we stayed in.', 'becuse'],
      ['He said: "Fine."\nbecuse we were late.', 'becuse'],
      ['"becuse it was late," she said.', 'becuse'],
    ] as const) {
      expect((await issueAt(text, word))?.replacements[0]).toBe('Because');
    }
  });

  it('keeps the fix lowercase in the middle of a sentence', async () => {
    expect((await issueAt('I left becuse it rained.', 'becuse'))?.replacements[0]).toBe('because');
    expect((await issueAt('We met, becuse it rained.', 'becuse'))?.replacements[0]).toBe('because');
  });

  it('leaves fixes that already have a capital, and capitalised misspellings, as they are', async () => {
    expect((await issueAt('Becuse I left early.', 'Becuse'))?.replacements[0]).toBe('Because');
    expect((await issueAt('i left early.', 'i'))?.replacements[0]).toBe('I');
  });
});

describe('initials', () => {
  it('does not flag the initials of a name', async () => {
    const issues = await american.lint('J. S. Bach wrote it for A. Smith and J.S. Mill.');
    expect(issues.filter((issue) => issue.category === 'spelling')).toEqual([]);
  });

  it('still flags a misspelling next to initials', async () => {
    expect((await issueAt('The sergent S. M. Smith told us.', 'sergent'))?.replacements[0]).toBe('sergeant');
  });
});

describe('rules surer than a spelling guess', () => {
  it('gives the irregular past tense instead of a spelling guess', async () => {
    const issue = await issueAt('She speaked to me.', 'speaked');
    expect(issue?.ruleId).toBe('RegularIrregulars');
    expect(issue?.replacements[0]).toBe('spoke');
  });

  it('keeps the spelling guess when a typo only looks like a wrong negative', async () => {
    const issue = await issueAt('They try another untill they know how.', 'untill');
    expect(issue?.ruleId).toBe('SpellCheck');
    expect(issue?.replacements[0]).toBe('until');
  });
});

describe('muted opinion rules', () => {
  it('leaves old place names and litotes alone', async () => {
    for (const text of ['We flew to Bombay and then to Turkey.', 'It was not unusual for her to ask.']) {
      const rules = (await american.lint(text)).map((issue) => issue.ruleId);
      expect(rules).not.toContain('UpdatePlaceNames');
      expect(rules).not.toContain('LitotesDirectPositive');
    }
  });
});
