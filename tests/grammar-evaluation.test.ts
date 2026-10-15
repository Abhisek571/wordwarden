// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WordwardenCore } from '#/engines/wordwarden-core';
import { CORRECT_SENTENCES, GRAMMAR_MISTAKES } from './fixtures/grammar-cases';
import { createProductionEngine } from './helpers/production-engine';

let engine: WordwardenCore;

beforeAll(async () => {
  engine = await createProductionEngine('american');
}, 60_000);

afterAll(async () => {
  await engine.dispose();
});

describe('grammar evaluation set', () => {
  it('fixes common grammar mistakes and leaves correct sentences alone', async () => {
    const missed: string[] = [];
    let fixed = 0;
    for (const mistake of GRAMMAR_MISTAKES) {
      const issues = await engine.lint(mistake.text);
      const match = issues.find((issue) => issue.originalText === mistake.original);
      if (match?.replacements[0] === mistake.fix) fixed += 1;
      else {
        const found = issues.map((issue) => `${issue.originalText}→${issue.replacements[0] ?? '∅'} (${issue.ruleId})`).join(', ');
        missed.push(`${mistake.text} [want ${mistake.original}→${mistake.fix}; got ${found || 'nothing'}]`);
      }
    }
    const falseAlarms: string[] = [];
    for (const sentence of CORRECT_SENTENCES) {
      const issues = await engine.lint(sentence);
      if (issues.length > 0) {
        falseAlarms.push(`${sentence} [${issues.map((issue) => `${issue.originalText}→${issue.replacements[0] ?? '∅'} (${issue.ruleId})`).join(', ')}]`);
      }
    }
    console.log(`GRAMMAR_EVALUATION fixed=${fixed}/${GRAMMAR_MISTAKES.length} falseAlarms=${falseAlarms.length}/${CORRECT_SENTENCES.length}`);
    for (const line of missed) console.log(`MISSED ${line}`);
    for (const line of falseAlarms) console.log(`FALSE_ALARM ${line}`);

    expect(falseAlarms).toEqual([]);
    expect(fixed).toBeGreaterThanOrEqual(67);
  }, 60_000);
});
