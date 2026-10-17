import { describe, expect, it } from 'vitest';
import type { WritingIssue } from '#/core/types';
import {
  excludeIssuesOverlappingSpelling,
  issueMatchesText,
  rebaseIssuesAfterReplacement,
} from '#/core/issue-ranges';

function issue(
  id: string,
  start: number,
  end: number,
  category: WritingIssue['category'] = 'spelling',
): WritingIssue {
  return Object.freeze({
    id,
    source: 'core',
    ruleId: 'SpellCheck',
    range: Object.freeze({ start, end }),
    category,
    message: 'Spelling issue',
    replacements: Object.freeze(['fixed']),
    originalText: '',
    issueHash: `hash-${id}`,
  });
}

describe('issue source validation', () => {
  it('accepts only the exact text and range originally analyzed', () => {
    const current = Object.freeze({ ...issue('current', 5, 8), originalText: 'are' });
    expect(issueMatchesText(current, 'This are wrong.')).toBe(true);
    expect(issueMatchesText(current, 'This is wrong.')).toBe(false);
    expect(issueMatchesText(Object.freeze({
      ...current,
      range: Object.freeze({ start: 8, end: 5 }),
      originalText: '',
    }), 'This are wrong.')).toBe(false);
  });
});

describe('issue range rebasing', () => {
  it('keeps later issues aligned after a shorter replacement', () => {
    const first = issue('first', 5, 8);
    const second = issue('second', 19, 22);

    const remaining = rebaseIssuesAfterReplacement(
      Object.freeze([first, second]),
      first,
      'is',
    );

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe('second');
    expect(remaining[0]?.range).toEqual({ start: 18, end: 21 });
  });

  it('drops issues that overlap the replaced text', () => {
    const applied = issue('applied', 5, 10);
    const overlapping = issue('overlapping', 8, 12);

    expect(
      rebaseIssuesAfterReplacement(
        Object.freeze([applied, overlapping]),
        applied,
        'fixed',
      ),
    ).toEqual([]);
  });
});

describe('spelling-first issue filtering', () => {
  it('removes non-spelling issues that overlap a spelling error', () => {
    const grammar = issue('grammar', 0, 12, 'grammar');
    const spelling = issue('spelling', 4, 8);

    expect(excludeIssuesOverlappingSpelling([grammar, spelling])).toEqual([spelling]);
  });

  it('keeps non-overlapping grammar issues', () => {
    const spelling = issue('spelling', 4, 8);
    const grammar = issue('grammar', 20, 25, 'grammar');

    expect(excludeIssuesOverlappingSpelling([spelling, grammar])).toEqual([
      spelling,
      grammar,
    ]);
  });

  it('removes an insertion issue at the edge of a spelling error', () => {
    const spelling = issue('spelling', 0, 4);
    const punctuation = issue('punctuation', 4, 4, 'punctuation');

    expect(excludeIssuesOverlappingSpelling([spelling, punctuation])).toEqual([
      spelling,
    ]);
  });

  it('keeps an insertion issue away from a spelling error', () => {
    const spelling = issue('spelling', 0, 4);
    const punctuation = issue('punctuation', 9, 9, 'punctuation');

    expect(excludeIssuesOverlappingSpelling([spelling, punctuation])).toEqual([
      spelling,
      punctuation,
    ]);
  });

  it('keeps a specific rule and drops the spelling guess inside it', () => {
    // "Back in the 1960's": PluralDecades fixes "1960's", SpellCheck guesses at its "s".
    const decades = Object.freeze({ ...issue('decades', 12, 18, 'grammar'), ruleId: 'PluralDecades' });
    const guess = issue('guess', 17, 18);
    expect(excludeIssuesOverlappingSpelling([decades, guess])).toEqual([decades]);
  });

  it('keeps the spelling guess over a capitalisation rule on the same word ("brian" is usually "brain")', () => {
    const capital = Object.freeze({ ...issue('capital', 5, 10, 'capitalization'), ruleId: 'OrthographicConsistency' });
    const spelling = issue('word', 5, 10);
    expect(excludeIssuesOverlappingSpelling([capital, spelling])).toEqual([spelling]);
  });

  it('still lets the spelling guess win over other rules and over a specific rule that only partly covers it', () => {
    const spelling = issue('spelling', 4, 10);
    const other = Object.freeze({ ...issue('other', 4, 10, 'grammar'), ruleId: 'WrongNegative' });
    const partial = Object.freeze({ ...issue('partial', 0, 6, 'grammar'), ruleId: 'SplitWords' });
    expect(excludeIssuesOverlappingSpelling([spelling, other, partial])).toEqual([spelling]);
  });
});
