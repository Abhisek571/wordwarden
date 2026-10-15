// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Checker, Dialect, initSync } from '../core/dist/wordwarden_core.js';

type Finding = Readonly<{ rule: string; start: number; end: number; kind: string; suggestions: readonly string[] }>;

// The engine and the JavaScript that loads it are built together into core/dist by scripts/build-core.mjs.
initSync({ module: readFileSync(new URL('../core/dist/wordwarden_core_bg.wasm', import.meta.url)) });

const checkers: Checker[] = [];
function checker(): Checker {
  const next = new Checker(Dialect.American);
  checkers.push(next);
  return next;
}
afterEach(() => {
  for (const used of checkers.splice(0)) used.free();
});

describe('bundled Wordwarden core engine', () => {
  it('loads with its JavaScript and checks text', () => {
    const findings = checker().check('This is a apple.') as readonly Finding[];
    expect(findings).toContainEqual(expect.objectContaining({ rule: 'AnA', start: 8, end: 9, suggestions: ['an'] }));
  });

  it('gives positions in UTF-16 code units, as JavaScript strings count them', () => {
    const text = '😀 This is a apple.';
    const findings = checker().check(text) as readonly Finding[];
    const anA = findings.find((finding) => finding.rule === 'AnA');
    expect(anA).toBeDefined();
    expect(text.slice(anA?.start, anA?.end)).toBe('a');
  });

  it('keeps added words and rule settings', () => {
    const core = checker();
    const spelling = (): readonly Finding[] => (core.check('I met Zqxvbe today.') as readonly Finding[])
      .filter((finding) => finding.kind === 'Spelling');
    expect(spelling()).toHaveLength(1);
    core.add_words(['Zqxvbe']);
    expect(spelling()).toHaveLength(0);
    core.set_rules({ AnA: false });
    expect((core.check('This is a apple.') as readonly Finding[]).some((finding) => finding.rule === 'AnA')).toBe(false);
  });
});
