import { describe, expect, it } from 'vitest';
import type { WritingIssue } from '#/core/types';
import {
  lintSupplementalGrammar,
  supplementGrammarIssues,
} from '#/engines/grammar-rules';

const example =
  'Me and my friend was going to the shops yesterday but we doesnt know where it is so we was walking around for nearly two hour and then someone tell us that the shop have already closed before we got there.';

function issue(
  id: string,
  category: WritingIssue['category'],
  start: number,
  end: number,
): WritingIssue {
  return Object.freeze({
    id,
    source: 'core',
    ruleId: id,
    range: Object.freeze({ start, end }),
    category,
    message: id,
    replacements: Object.freeze([]),
    originalText: '',
    issueHash: id,
  });
}

describe('supplemental grammar rules', () => {
  it('finds the high-confidence grammar errors the core misses in the reported sentence', () => {
    const issues = lintSupplementalGrammar(example);
    const findings = issues.map((finding) => ({
      range: finding.range,
      problem: example.slice(finding.range.start, finding.range.end),
      replacement: finding.replacements[0],
    }));
    const firstWas = example.indexOf('was');
    const secondWas = example.indexOf('was', firstWas + 1);
    const hour = example.indexOf('hour');
    const tell = example.indexOf('tell');
    const have = example.indexOf('have');

    expect(findings).toEqual(expect.arrayContaining([
      { range: { start: 0, end: 16 }, problem: 'Me and my friend', replacement: 'My friend and I' },
      { range: { start: firstWas, end: firstWas + 3 }, problem: 'was', replacement: 'were' },
      { range: { start: secondWas, end: secondWas + 3 }, problem: 'was', replacement: 'were' },
      { range: { start: hour, end: hour + 4 }, problem: 'hour', replacement: 'hours' },
      { range: { start: tell, end: tell + 4 }, problem: 'tell', replacement: 'told' },
      { range: { start: have, end: have + 4 }, problem: 'have', replacement: 'had' },
    ]));
  });

  it('does not treat a sentence-opening imperative as subject-verb disagreement', () => {
    expect(lintSupplementalGrammar('Someone tell us!')).toEqual([]);
  });

  it('leaves joined clauses, gerund-phrase subjects, and modifiers before "have" alone', () => {
    const clean = [
      'Understanding concepts and ideas is a more important way of studying.',
      'I was tired and the night is meant for sleeping.',
      'Many companies around the world have introduced new practices.',
      'Members that already have the certification will return.',
      'This will have a great effect on him.',
      'Therefore people will be able to live with nature.',
    ];
    for (const text of clean) expect(lintSupplementalGrammar(text), text).toEqual([]);
    expect(lintSupplementalGrammar('Me and my friend was late.').map((finding) => finding.replacements[0]))
      .toEqual(['My friend and I', 'were']);
    expect(lintSupplementalGrammar('However the shop have closed.').map((finding) => finding.ruleId))
      .toEqual(['IntroductoryComma', 'SingularSubjectHave']);
  });

  it('detects agreement after a spelling correction creates a valid contraction', () => {
    const text = "We doesn't know.";
    const issues = lintSupplementalGrammar(text);

    expect(issues).toHaveLength(1);
    expect(text.slice(issues[0]?.range.start, issues[0]?.range.end)).toBe("doesn't");
    expect(issues[0]?.replacements[0]).toBe("don't");
  });

  it('keeps style secondary and does not duplicate an existing grammar range', () => {
    const wasStart = example.indexOf('was');
    const style = issue('LongSentences', 'style', 0, example.length);
    const grammar = issue('ExistingAgreement', 'grammar', wasStart, wasStart + 3);
    const combined = supplementGrammarIssues([style, grammar], example);

    expect(combined.at(-1)?.category).toBe('style');
    expect(
      combined.filter(
        (finding) => finding.range.start === wasStart && finding.range.end === wasStart + 3,
      ),
    ).toHaveLength(1);
  });

  it('offers only supported local punctuation corrections with exact ranges', () => {
    const text = 'We walked for two hour. It was a two hour walk and we dont agree';
    const findings = lintSupplementalGrammar(text);

    expect(findings.map((finding) => ({
      category: finding.category,
      original: text.slice(finding.range.start, finding.range.end),
      replacement: finding.replacements[0],
    }))).toEqual(expect.arrayContaining([
      { category: 'grammar', original: 'hour', replacement: 'hours' },
      { category: 'punctuation', original: 'two hour', replacement: 'two-hour' },
      { category: 'punctuation', original: 'dont', replacement: "don't" },
      { category: 'punctuation', original: 'agree', replacement: 'agree.' },
    ]));
  });

  it('does not require sentence-ending punctuation for a single word', () => {
    expect(lintSupplementalGrammar('hello')).toEqual([]);
    expect(lintSupplementalGrammar('thta')).toEqual([]);
  });

  it('still offers sentence-ending punctuation for multi-word text', () => {
    const text = 'hello there';
    const issue = lintSupplementalGrammar(text).find(
      (finding) => finding.ruleId === 'SentenceEndingPunctuation',
    );

    expect(issue?.replacements).toEqual(['there.']);
  });

  it('defers sentence-ending punctuation when the final token has a prefix completion', () => {
    const issues = lintSupplementalGrammar('the const', (token) => token === 'const');

    expect(issues.find((finding) => finding.ruleId === 'SentenceEndingPunctuation')).toBeUndefined();
  });

  it('merges a doubled comma, with or without a space between', () => {
    const issues = lintSupplementalGrammar('It was slow,, like, , a snail.')
      .filter((finding) => finding.ruleId === 'RepeatedComma');

    expect(issues.map((issue) => [issue.originalText, issue.replacements, issue.category])).toEqual([
      [',,', [','], 'punctuation'],
      [', ,', [','], 'punctuation'],
    ]);
  });

  it('reduces multiple interior spaces without changing tabs, line breaks, or indentation', () => {
    const text = 'Use  one space.\n  Keep\tthis unchanged.';
    const issue = lintSupplementalGrammar(text).find(
      (finding) => finding.ruleId === 'MultipleSpaces',
    );

    expect(issue).toMatchObject({
      range: { start: 3, end: 5 },
      replacements: [' '],
      category: 'punctuation',
    });
  });
});

describe('sentence-ending punctuation', () => {
  function ending(text: string): string | undefined {
    return lintSupplementalGrammar(text)
      .find((finding) => finding.ruleId === 'SentenceEndingPunctuation')?.replacements[0];
  }

  it('suggests a question mark for questions', () => {
    expect(ending('why was the file changed')).toBe('changed?');
    expect(ending('Did you send the report')).toBe('report?');
    expect(ending('should we start now')).toBe('now?');
  });

  it('keeps a full stop for statements and commands', () => {
    expect(ending('the file changed')).toBe('changed.');
    expect(ending('Do it now')).toBe('now.');
    expect(ending('Have a nice day')).toBe('day.');
    expect(ending('What a great day')).toBe('day.');
  });
});
