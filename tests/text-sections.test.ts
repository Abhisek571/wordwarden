import { describe, expect, it } from 'vitest';
import { createAnalysisSections, rebaseSectionRange } from '#/engines/text-sections';

describe('long-text analysis sections', () => {
  it('splits long prose at logical boundaries and maps local ranges back exactly', () => {
    const text = `${'Opening words, but '.repeat(12)}we was walking around for nearly two hour, so someone tell us the news.`;
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
