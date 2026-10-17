import { describe, expect, it } from 'vitest';
import { createAnalysisSections, rebaseSectionRange } from '#/engines/text-sections';

describe('long-text analysis sections', () => {
  it('splits long prose at logical boundaries and maps local ranges back exactly', () => {
    const text = `${'Opening words, but '.repeat(30)}we was walking around for nearly two hour, so someone tell us the news.`;
    const sections = createAnalysisSections(text);
    const section = sections.find((candidate) => candidate.text.includes('we was'));

    expect(sections.length).toBeGreaterThan(1);
    expect(section).toBeDefined();
    const localStart = section?.text.indexOf('we was') ?? -1;
    const range = section === undefined ? null : rebaseSectionRange(section, {
      start: localStart,
      end: localStart + 'we was'.length,
    });
    expect(range).not.toBeNull();
    expect(text.slice(range?.start, range?.end)).toBe('we was');
  });
});

describe('section cuts', () => {
  const filler = (length: number): string => 'word '.repeat(Math.ceil(length / 5)).slice(0, length);

  it('keeps a finding that starts in a section and ends in the next one', () => {
    const text = `${filler(398)}could of done it.`;
    const sections = createAnalysisSections(text);
    const start = text.indexOf('could');
    const owner = sections.filter((section) => (
      rebaseSectionRange(section, { start: start - section.sourceStart, end: start + 'could of'.length - section.sourceStart }) !== null
    ));
    expect(owner).toHaveLength(1);
  });

  it('ends the last section at the end of the text, not before the last word', () => {
    const text = `${filler(420)}should of`;
    const sections = createAnalysisSections(text);
    const last = sections.at(-1);
    expect((last?.sourceStart ?? 0) + (last?.localRange.end ?? 0)).toBe(text.length);
    expect(last?.text.endsWith('should of')).toBe(true);
    expect(sections.filter((section) => section.text.slice(section.localRange.start, section.localRange.end) === 'of'))
      .toHaveLength(0);
  });

  it('never cuts inside a long link', () => {
    const link = `https://example.com/?${'a=1&b=two&'.repeat(80)}`;
    const text = `See ${link} for details and more words here.`;
    const sections = createAnalysisSections(text);
    const linkStart = text.indexOf('https');
    const holder = sections.find((section) => section.text.includes(link));
    expect(holder).toBeDefined();
    expect(sections.some((section) => {
      const start = section.sourceStart + section.localRange.start;
      return start > linkStart && start < linkStart + link.length;
    })).toBe(false);
  });
});
