// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { WritingIssue } from '#/core/types';
import { createProductionEngine, readBundledExtraWords } from './helpers/production-engine';

function spellingIssuesFor(issues: readonly WritingIssue[], text: string): readonly WritingIssue[] {
  return issues.filter((issue) => issue.category === 'spelling' && issue.originalText === text);
}

describe('bundled extra words (SCOWL size 70)', () => {
  it('ships a sorted list of plain lower-case words for each dialect', async () => {
    for (const dialect of ['american', 'british', 'canadian', 'australian'] as const) {
      const words = await readBundledExtraWords(dialect);
      expect(words.length).toBeGreaterThan(4000);
      expect(words).toEqual([...words].sort());
      expect(words.every((word) => /^[a-z]{3,}$/u.test(word))).toBe(true);
    }
  });

  it('stops flagging less common words while still catching misspellings', async () => {
    const engine = await createProductionEngine('american');
    try {
      const issues = await engine.lint('The storyline of the matchup read like a wrogn accelerometer trace from Wembley.');
      expect(spellingIssuesFor(issues, 'storyline')).toEqual([]);
      expect(spellingIssuesFor(issues, 'matchup')).toEqual([]);
      expect(spellingIssuesFor(issues, 'accelerometer')).toEqual([]);
      expect(spellingIssuesFor(issues, 'Wembley')).toEqual([]);
      expect(spellingIssuesFor(issues, 'wrogn')).toHaveLength(1);
    } finally {
      await engine.dispose();
    }
  }, 60_000);
});
