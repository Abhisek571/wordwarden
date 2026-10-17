// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WritingIssue } from '#/core/types';
import type { WordwardenCore } from '#/engines/wordwarden-core';
import { createProductionEngine } from './helpers/production-engine';

let american: WordwardenCore;
let british: WordwardenCore;

beforeAll(async () => {
  [american, british] = await Promise.all([createProductionEngine('american'), createProductionEngine('british')]);
}, 120_000);

afterAll(async () => {
  await Promise.all([american.dispose(), british.dispose()]);
});

function at(issues: readonly WritingIssue[], text: string, word: string): WritingIssue | undefined {
  const start = text.indexOf(word);
  return issues.find((issue) => issue.range.start === start && issue.range.end === start + word.length);
}

// Applies the first fix, as clicking it on the card does.
function applyFirst(text: string, issue: WritingIssue | undefined): string {
  if (issue === undefined) throw new Error('no issue');
  return `${text.slice(0, issue.range.start)}${issue.replacements[0] ?? ''}${text.slice(issue.range.end)}`;
}

describe('the shipped engine', () => {
  it('keeps the flagged word when a fix inserts text after it', async () => {
    for (const [text, word, fixed] of [
      ['There are a lot people here.', 'lot', 'There are a lot of people here.'],
      ['A couple months ago we met.', 'couple', 'A couple of months ago we met.'],
    ] as const) {
      expect(applyFirst(text, at(await american.lint(text), text, word))).toBe(fixed);
    }
  });

  it('survives text that used to abort the core, and keeps checking', async () => {
    for (const text of ['I want both 3', "THERE'S PEOPLE", 'Both two']) {
      await expect(american.lint(text)).resolves.toBeDefined();
    }
    const text = 'This is a apple.';
    expect(at(await american.lint(text), text, 'a')?.replacements[0]).toBe('an');
  });

  it('offers the capitalised word for a name or acronym typed in lowercase', async () => {
    for (const [text, word, fix] of [
      ['I live in london now.', 'london', 'London'],
      ['See you on monday then.', 'monday', 'Monday'],
      ["yeah i know, i'm late", "i'm", "I'm"],
    ] as const) {
      expect(at(await american.lint(text), text, word)?.replacements[0], text).toBe(fix);
    }
  });

  it('keeps a lowercase fix lowercase', async () => {
    const text = 'Please excus me for a moment.';
    expect(at(await american.lint(text), text, 'excus')?.replacements[0]).toBe('excuse');
  });

  it("puts the dialect's own spelling first for another dialect's word", async () => {
    const us = 'I like the colour of it.';
    expect(at(await american.lint(us), us, 'colour')?.replacements[0]).toBe('color');
    const uk = 'The sky is gray today.';
    expect(at(await british.lint(uk), uk, 'gray')?.replacements[0]).toBe('grey');
  });

  it('keeps a specific fix over a spelling guess inside it', async () => {
    const text = "Back in the 1960's people wrote letters.";
    expect(applyFirst(text, (await american.lint(text)).find((issue) => issue.ruleId === 'PluralDecades')))
      .toBe('Back in the 1960s people wrote letters.');
    expect((await american.lint(text)).some((issue) => issue.ruleId === 'SpellCheck')).toBe(false);
  });

  it('never offers a slur, and a vulgar word only for a typo of it', async () => {
    for (const text of ['gg wp everyone', 'I saw kiek there.', 'The pense was blue.']) {
      const offered = (await american.lint(text)).flatMap((issue) => issue.replacements.map((word) => word.toLowerCase()));
      expect(offered, text).not.toContain('wop');
      expect(offered, text).not.toContain('kike');
      expect(offered, text).not.toContain('penis');
    }
  });

  it('leaves questions with a base verb alone', async () => {
    for (const text of ['Does anyone know the answer?', 'I will let everyone know.']) {
      expect((await american.lint(text)).filter((issue) => issue.ruleId === 'IndefiniteSubjectAgreement'), text)
        .toEqual([]);
    }
  });

  it('accepts a lowercase personal word added after its capitalised form', async () => {
    await american.addWords(['Blorpton']);
    await american.addWords(['blorpton']);
    const text = 'I met blorpton and Blorpton today.';
    expect((await american.lint(text)).filter((issue) => issue.category === 'spelling')).toEqual([]);
  });

  it('offers the right word for common slips', async () => {
    for (const [text, word, fix] of [
      ['im going home now.', 'im', "I'm"],
      ['thats a good idea.', 'thats', "that's"],
      ['What a beautifull sunset.', 'beautifull', 'beautiful'],
      ['You gave me bad advices.', 'advices', 'advice'],
    ] as const) {
      expect(at(await american.lint(text), text, word)?.replacements[0], text).toBe(fix);
    }
  });

  it("does not flag a spelling the dialect's own dictionary has", async () => {
    const text = 'She dreamed of home.';
    expect((await british.lint(text)).some((issue) => issue.originalText === 'dreamed')).toBe(false);
  });
});
