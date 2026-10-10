// Real-world accuracy benchmarks. Datasets live outside the repository; see docs/BENCHMARKS.md.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WritingIssue } from '#/core/types';
import type { HarperEngine } from '#/engines/harper-engine';
import { createProductionEngine } from './helpers/production-engine';

const benchmarkDirectory = process.env.WORDWARDEN_BENCHMARK_DIR ?? 'E:/CODING/Wordwarden/benchmarks';
const birkbeckDirectory = resolve(benchmarkDirectory, 'birkbeck');
const jflegDirectory = resolve(benchmarkDirectory, 'jfleg');
const FAILURE_EXAMPLES = 20;

type Split = 'tune' | 'holdout';
type SpellingPair = Readonly<{ misspelling: string; targets: readonly string[]; split: Split }>;
type Counts = { total: number; detected: number; topOne: number; topThree: number };
type Report = Record<string, unknown>;

const report: Report = {};
let american: HarperEngine;
let british: HarperEngine;

function emptyCounts(): Counts {
  return { total: 0, detected: 0, topOne: 0, topThree: 0 };
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

function rates(counts: Counts): Report {
  return {
    ...counts,
    detectedPct: percent(counts.detected, counts.total),
    topOnePct: percent(counts.topOne, counts.total),
    topThreePct: percent(counts.topThree, counts.total),
  };
}

// Stable split so rules can be tuned on one half and reported on the other.
function splitFor(key: string): Split {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % 2 === 0 ? 'tune' : 'holdout';
}

function issueSummary(issue: WritingIssue): string {
  return `${issue.originalText}→${issue.replacements[0] ?? '∅'} (${issue.ruleId})`;
}

/** Mitton's format: "$target" lines, each followed by its misspellings. */
function parseMisspellingList(source: string): readonly SpellingPair[] {
  const targetsByMisspelling = new Map<string, Set<string>>();
  let target: string | null = null;
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('$')) {
      target = line.slice(1);
      continue;
    }
    if (target === null || line.includes('_') || target.includes('_')) continue;
    if (!/^[\p{L}'-]+$/u.test(line) || !/^[\p{L}'-]+$/u.test(target)) continue;
    if (line.toLocaleLowerCase('en') === target.toLocaleLowerCase('en')) continue;
    const targets = targetsByMisspelling.get(line) ?? new Set<string>();
    targets.add(target);
    targetsByMisspelling.set(line, targets);
  }
  return Object.freeze([...targetsByMisspelling].map(([misspelling, targets]) => Object.freeze({
    misspelling,
    targets: Object.freeze([...targets]),
    split: splitFor(misspelling),
  })));
}

async function evaluateWordList(
  name: string,
  file: string,
  engine: HarperEngine,
): Promise<void> {
  const path = resolve(birkbeckDirectory, file);
  if (!existsSync(path)) {
    report[name] = { skipped: `missing ${path}` };
    return;
  }
  const pairs = parseMisspellingList(await readFile(path, 'utf8'));
  const counts: Record<Split, Counts> = { tune: emptyCounts(), holdout: emptyCounts() };
  const misses: string[] = [];
  for (const pair of pairs) {
    const issues = await engine.lint(pair.misspelling);
    const issue = issues.find((candidate) => candidate.range.start === 0);
    const wanted = pair.targets.map((target) => target.toLocaleLowerCase('en'));
    const suggestions = (issue?.replacements ?? []).map((value) => value.toLocaleLowerCase('en'));
    const bucket = counts[pair.split];
    bucket.total += 1;
    if (issue !== undefined) bucket.detected += 1;
    if (suggestions[0] !== undefined && wanted.includes(suggestions[0])) bucket.topOne += 1;
    if (suggestions.slice(0, 3).some((suggestion) => wanted.includes(suggestion))) bucket.topThree += 1;
    else if (issue !== undefined && misses.length < FAILURE_EXAMPLES && pair.split === 'holdout') {
      misses.push(`${pair.misspelling} → want ${pair.targets.join('/')}; got ${suggestions.slice(0, 3).join(', ') || '∅'}`);
    }
  }
  report[name] = { tune: rates(counts.tune), holdout: rates(counts.holdout), holdoutMisses: misses };
}

/** JFLEG text is tokenized ("siences ."); rejoin it the way people type. */
export function detokenize(line: string): string {
  return ` ${line.trim()} `
    .replace(/``\s*/gu, '"')
    .replace(/\s*''/gu, '"')
    .replace(/ ([.,!?;:%)\]}])/gu, '$1')
    .replace(/([([{$]) /gu, '$1')
    .replace(/ (n't|'s|'re|'ve|'ll|'d|'m)(?=[\s.,!?;:])/giu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

function words(text: string): readonly string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\s\p{L}\p{N}]/gu) ?? [];
}

function tokenDistance(left: readonly string[], right: readonly string[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? right.length;
}

async function readLines(path: string): Promise<readonly string[]> {
  return (await readFile(path, 'utf8')).split(/\r?\n/u).filter((line) => line.trim().length > 0);
}

async function evaluateJfleg(split: 'dev' | 'test', label: Split): Promise<void> {
  const sourcePath = resolve(jflegDirectory, `${split}.src`);
  if (!existsSync(sourcePath)) {
    report[`jfleg-${label}`] = { skipped: `missing ${sourcePath}` };
    return;
  }
  const sources = (await readLines(sourcePath)).map(detokenize);
  const references = await Promise.all([0, 1, 2, 3].map(async (index) => (
    (await readLines(resolve(jflegDirectory, `${split}.ref${index}`))).map(detokenize)
  )));

  // Clean text: human-corrected sentences should get (almost) no underlines.
  let cleanSentences = 0;
  let flaggedCleanSentences = 0;
  let cleanFlags = 0;
  const cleanByRule = new Map<string, number>();
  const falseAlarms: string[] = [];
  for (const reference of references) {
    for (const sentence of reference) {
      cleanSentences += 1;
      const issues = await american.lint(sentence);
      if (issues.length === 0) continue;
      flaggedCleanSentences += 1;
      cleanFlags += issues.length;
      for (const issue of issues) cleanByRule.set(issue.ruleId, (cleanByRule.get(issue.ruleId) ?? 0) + 1);
      if (falseAlarms.length < FAILURE_EXAMPLES) falseAlarms.push(`${sentence} [${issues.map(issueSummary).join(', ')}]`);
    }
  }

  // Learner text: a flag is useful when its first fix moves the sentence closer to a human correction.
  let flags = 0;
  let helpfulFixes = 0;
  let sentencesNeedingEdits = 0;
  let sentencesFlagged = 0;
  const unhelpful: string[] = [];
  for (const [index, source] of sources.entries()) {
    const refs = references.map((reference) => reference[index] ?? source);
    const sourceWords = words(source);
    const baseline = Math.min(...refs.map((ref) => tokenDistance(sourceWords, words(ref))));
    const needsEdits = refs.every((ref) => ref !== source);
    if (needsEdits) sentencesNeedingEdits += 1;
    const issues = await american.lint(source);
    if (needsEdits && issues.length > 0) sentencesFlagged += 1;
    for (const issue of issues) {
      const fix = issue.replacements[0];
      if (fix === undefined) continue;
      flags += 1;
      const edited = `${source.slice(0, issue.range.start)}${fix}${source.slice(issue.range.end)}`;
      const after = Math.min(...refs.map((ref) => tokenDistance(words(edited), words(ref))));
      if (after < baseline) helpfulFixes += 1;
      else if (unhelpful.length < FAILURE_EXAMPLES) unhelpful.push(`${source} [${issueSummary(issue)}]`);
    }
  }

  report[`jfleg-${label}`] = {
    cleanText: {
      sentences: cleanSentences,
      flaggedSentences: flaggedCleanSentences,
      flaggedSentencesPct: percent(flaggedCleanSentences, cleanSentences),
      flagsPer100Sentences: Math.round((cleanFlags / cleanSentences) * 1000) / 10,
      topRules: Object.fromEntries([...cleanByRule].sort((a, b) => b[1] - a[1]).slice(0, 10)),
      examples: falseAlarms,
    },
    learnerText: {
      sentences: sources.length,
      sentencesNeedingEdits,
      sentencesFlagged,
      sentenceRecallPct: percent(sentencesFlagged, sentencesNeedingEdits),
      fixesSuggested: flags,
      helpfulFixes,
      fixPrecisionPct: percent(helpfulFixes, flags),
      unhelpfulExamples: unhelpful,
    },
  };
}

type TaggedLine = Readonly<{ text: string; errors: readonly Readonly<{ start: number; end: number; target: string }>[] }>;

/** Holbrook passages: `<ERR targ=sister> siter </ERR>` marks a misspelling in running text. */
function parseHolbrook(source: string): readonly TaggedLine[] {
  const lines: TaggedLine[] = [];
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || /^\d+\.$/u.test(line) || /\bpage \d+\s*$/iu.test(line)) continue;
    let text = '';
    const errors: { start: number; end: number; target: string }[] = [];
    for (const match of line.matchAll(/<ERR targ=([^>]*)>\s*(.*?)\s*<\/ERR>|(\S+)/gu)) {
      const piece = match[3] ?? match[2] ?? '';
      if (piece.length === 0) continue;
      const attaches = /^(?:[.,!?;:)%]|n't|'s|'re|'ve|'ll|'d|'m)$/iu.test(piece);
      if (text.length > 0 && !attaches) text += ' ';
      const start = text.length;
      text += piece;
      if (match[1] !== undefined) errors.push({ start, end: text.length, target: match[1].trim() });
    }
    if (text.length > 0) lines.push(Object.freeze({ text, errors: Object.freeze(errors) }));
  }
  return Object.freeze(lines);
}

async function evaluateHolbrook(): Promise<void> {
  const path = resolve(birkbeckDirectory, 'holbrook-tagged.dat');
  if (!existsSync(path)) {
    report.holbrook = { skipped: `missing ${path}` };
    return;
  }
  const counts = emptyCounts();
  let spellingFlags = 0;
  let spellingFlagsOnTaggedErrors = 0;
  const falseAlarms: string[] = [];
  for (const line of parseHolbrook(await readFile(path, 'utf8'))) {
    const issues = await british.lint(line.text);
    for (const error of line.errors) {
      counts.total += 1;
      const issue = issues.find((candidate) => candidate.range.start < error.end && error.start < candidate.range.end);
      if (issue === undefined) continue;
      counts.detected += 1;
      const target = error.target.toLocaleLowerCase('en');
      const suggestions = issue.replacements.map((value) => value.toLocaleLowerCase('en'));
      if (suggestions[0] === target) counts.topOne += 1;
      if (suggestions.slice(0, 3).includes(target)) counts.topThree += 1;
    }
    for (const issue of issues.filter((candidate) => candidate.category === 'spelling')) {
      spellingFlags += 1;
      const onError = line.errors.some((error) => issue.range.start < error.end && error.start < issue.range.end);
      if (onError) spellingFlagsOnTaggedErrors += 1;
      else if (falseAlarms.length < FAILURE_EXAMPLES) falseAlarms.push(`${line.text} [${issueSummary(issue)}]`);
    }
  }
  report.holbrook = {
    taggedErrors: rates(counts),
    spellingFlags,
    spellingPrecisionPct: percent(spellingFlagsOnTaggedErrors, spellingFlags),
    spellingFalseAlarmExamples: falseAlarms,
  };
}

async function evaluateSpeed(): Promise<void> {
  const path = resolve(jflegDirectory, 'dev.ref0');
  if (!existsSync(path)) return;
  const sentences = (await readLines(path)).map(detokenize);
  let text = '';
  for (const sentence of sentences) {
    if (text.split(/\s+/u).length >= 500) break;
    text += `${sentence} `;
  }
  await american.lint(text);
  const timings: number[] = [];
  for (let run = 0; run < 7; run += 1) {
    const started = performance.now();
    await american.lint(text);
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  report.speed = { words: text.split(/\s+/u).length - 1, medianMs: Math.round(timings[3] ?? 0) };
}

beforeAll(async () => {
  [american, british] = await Promise.all([createProductionEngine('american'), createProductionEngine('british')]);
}, 120_000);

afterAll(async () => {
  await Promise.all([american?.dispose(), british?.dispose()]);
});

describe('real-world benchmarks', () => {
  it('reports spelling, grammar, false-alarm, and speed results', async () => {
    await evaluateWordList('birkbeck', 'missp.dat', british);
    await evaluateWordList('wikipedia', 'wikipedia.dat', american);
    await evaluateWordList('aspell', 'aspell.dat', american);
    await evaluateHolbrook();
    await evaluateJfleg('dev', 'tune');
    await evaluateJfleg('test', 'holdout');
    await evaluateSpeed();
    console.log(`WORDWARDEN_BENCHMARK_REPORT=${JSON.stringify(report, null, 2)}`);
    expect(Object.keys(report).length).toBeGreaterThan(0);
  });
});
