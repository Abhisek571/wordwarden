import type { WritingIssue } from './types';

function rangesOverlap(left: WritingIssue, right: WritingIssue): boolean {
  return left.range.start < right.range.end && right.range.start < left.range.end;
}

function touchesSpellingRange(issue: WritingIssue, spellingIssue: WritingIssue): boolean {
  if (rangesOverlap(issue, spellingIssue)) return true;

  const isInsertion = issue.range.start === issue.range.end;
  return isInsertion &&
    issue.range.start >= spellingIssue.range.start &&
    issue.range.start <= spellingIssue.range.end;
}

export function issueMatchesText(issue: WritingIssue, text: string): boolean {
  return Number.isInteger(issue.range.start) &&
    Number.isInteger(issue.range.end) &&
    issue.range.start >= 0 &&
    issue.range.end >= issue.range.start &&
    issue.range.end <= text.length &&
    text.slice(issue.range.start, issue.range.end) === issue.originalText;
}

export function excludeIssuesOverlappingSpelling(
  issues: readonly WritingIssue[],
): readonly WritingIssue[] {
  const spellingIssues = issues.filter((issue) => issue.category === 'spelling');
  return Object.freeze(
    issues.filter(
      (issue) =>
        issue.category === 'spelling' ||
        !spellingIssues.some((spellingIssue) => touchesSpellingRange(issue, spellingIssue)),
    ),
  );
}

/** Prefer the most specific actionable range when analyzers report overlaps. */
export function resolveOverlappingIssues(issues: readonly WritingIssue[]): readonly WritingIssue[] {
  const sorted = [...issues].sort((left, right) => {
    const categoryOrder = Number(left.category === 'style') - Number(right.category === 'style');
    if (categoryOrder !== 0) return categoryOrder;
    const sizeOrder = (left.range.end - left.range.start) - (right.range.end - right.range.start);
    if (sizeOrder !== 0) return sizeOrder;
    return left.range.start - right.range.start;
  });
  const kept: WritingIssue[] = [];
  for (const issue of sorted) {
    if (issue.category === 'style' || !kept.some((candidate) => candidate.category !== 'style' && rangesOverlap(candidate, issue))) {
      kept.push(issue);
    }
  }
  return Object.freeze(kept.sort((left, right) => left.range.start - right.range.start || left.range.end - right.range.end));
}

export function rebaseIssuesAfterReplacement(
  issues: readonly WritingIssue[],
  appliedIssue: WritingIssue,
  replacement: string,
): readonly WritingIssue[] {
  const delta = replacement.length - (appliedIssue.range.end - appliedIssue.range.start);

  return Object.freeze(
    issues.flatMap((issue) => {
      if (issue.id === appliedIssue.id) return [];
      if (issue.range.end <= appliedIssue.range.start) return [issue];
      if (issue.range.start < appliedIssue.range.end) return [];

      return [
        Object.freeze({
          ...issue,
          range: Object.freeze({
            start: issue.range.start + delta,
            end: issue.range.end + delta,
          }),
        }),
      ];
    }),
  );
}
