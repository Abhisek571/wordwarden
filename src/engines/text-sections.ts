import type { TextRange } from '#/core/types';

const MAX_SECTION_LENGTH = 180;
const CONTEXT_LENGTH = 48;

export type AnalysisSection = Readonly<{
  text: string;
  /** The part of `text` whose findings belong to this section. */
  localRange: TextRange;
  /** Offset of `text` in the original document. */
  sourceStart: number;
}>;

function splitAtLogicalBoundaries(text: string): readonly TextRange[] {
  const boundaries: number[] = [];
  for (const match of text.matchAll(/(?:[.!?]+\s+|[;:]\s+|,\s+(?=(?:and|but|or|so|yet|for|nor)\b))/giu)) {
    boundaries.push((match.index ?? 0) + match[0].length);
  }
  const ranges: TextRange[] = [];
  let start = 0;
  let boundaryIndex = 0;
  while (start < text.length) {
    const idealEnd = Math.min(start + MAX_SECTION_LENGTH, text.length);
    while ((boundaries[boundaryIndex] ?? Number.POSITIVE_INFINITY) <= start) boundaryIndex += 1;
    let boundary: number | undefined;
    while ((boundaries[boundaryIndex] ?? Number.POSITIVE_INFINITY) <= idealEnd) {
      boundary = boundaries[boundaryIndex];
      boundaryIndex += 1;
    }
    const wordBoundary = text.lastIndexOf(' ', idealEnd);
    const end = boundary ?? (wordBoundary > start ? wordBoundary + 1 : idealEnd);
    ranges.push(Object.freeze({ start, end }));
    start = end;
  }
  return ranges;
}

/**
 * Keeps expensive grammar analysis local for long prose while retaining a small
 * amount of neighbouring text for agreement and punctuation context.
 */
export function createAnalysisSections(text: string): readonly AnalysisSection[] {
  if (text.length <= MAX_SECTION_LENGTH) {
    return Object.freeze([Object.freeze({ text, localRange: Object.freeze({ start: 0, end: text.length }), sourceStart: 0 })]);
  }
  return Object.freeze(splitAtLogicalBoundaries(text).map((range) => {
    const sourceStart = Math.max(0, range.start - CONTEXT_LENGTH);
    const sourceEnd = Math.min(text.length, range.end + CONTEXT_LENGTH);
    return Object.freeze({
      text: text.slice(sourceStart, sourceEnd),
      localRange: Object.freeze({ start: range.start - sourceStart, end: range.end - sourceStart }),
      sourceStart,
    });
  }));
}

export function rebaseSectionRange(section: AnalysisSection, range: TextRange): TextRange | null {
  if (range.start < section.localRange.start || range.end > section.localRange.end) return null;
  return Object.freeze({ start: section.sourceStart + range.start, end: section.sourceStart + range.end });
}
