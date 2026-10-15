// Real-world accuracy benchmarks. Datasets live outside the repository; see docs/BENCHMARKS.md.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { binaryInlined } from 'harper.js/binaryInlined';
import { Dialect, LocalLinter } from 'harper.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WritingIssue } from '#/core/types';
import type { HarperEngine } from '#/engines/harper-engine';
import { createProductionEngine } from './helpers/production-engine';

const benchmarkDirectory = process.env.WORDWARDEN_BENCHMARK_DIR ?? 'E:/CODING/Wordwarden/benchmarks';
const birkbeckDirectory = resolve(benchmarkDirectory, 'birkbeck');
const jflegDirectory = resolve(benchmarkDirectory, 'jfleg');
const lexnormDirectory = resolve(benchmarkDirectory, 'lexnorm');
const aaltoSample = resolve(benchmarkDirectory, 'aalto', 'sample.tsv');
const FAILURE_EXAMPLES = 20;
// LanguageTool, for comparison: the folder holding languagetool-server.jar (or a LanguageTool-x.y folder with it).
const languageToolDirectory = process.env.WORDWARDEN_LANGUAGETOOL_DIR ?? resolve(benchmarkDirectory, 'languagetool');
const LANGUAGETOOL_PORT = 8081;
const harperVersion = (JSON.parse(await readFile(new URL('../node_modules/harper.js/package.json', import.meta.url), 'utf8')) as {
  version: string;
}).version;

type Split = 'tune' | 'holdout';
type SpellingPair = Readonly<{ misspelling: string; targets: readonly string[]; split: Split }>;
type Counts = { total: number; detected: number; topOne: number; topThree: number };
type Report = Record<string, unknown>;
type Checker = Readonly<{ lint(text: string): Promise<readonly WritingIssue[]> }>;
/** One rule's JFLEG tally: flags on learner text, how many of those fixes helped, flags on clean text. */
type RuleCounts = {
  kind: string; flags: number; helpful: number; cleanFlags: number;
  unhelpfulExamples: string[]; cleanExamples: string[];
};
const RULE_EXAMPLES = 5;
/**
 * One checker under test. Wordwarden's results go at the top of the report; LanguageTool's go under
 * `languagetool` and plain Harper's under `harper`, both using only the holdout halves, to keep their runs short.
 */
type Suite = Readonly<{ out: Report; american: Checker; british: Checker; holdoutOnly: boolean }>;

const report: Report = {};
let american: HarperEngine;
let british: HarperEngine;
let languageTool: ChildProcess | null = null;

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

function ruleCounts(byRule: Map<string, RuleCounts>, issue: WritingIssue): RuleCounts {
  const counts = byRule.get(issue.ruleId) ?? {
    kind: issue.category, flags: 0, helpful: 0, cleanFlags: 0, unhelpfulExamples: [], cleanExamples: [],
  };
  byRule.set(issue.ruleId, counts);
  return counts;
}

/** Per-rule table, worst fix precision first, so the rules doing the damage are easy to spot. */
function ruleTable(label: string, byRule: Map<string, RuleCounts>): string {
  const rows = [...byRule]
    .sort((a, b) => percent(a[1].helpful, a[1].flags) - percent(b[1].helpful, b[1].flags) || b[1].flags - a[1].flags)
    .map(([rule, counts]) => [
      rule.padEnd(34), counts.kind.padEnd(14), String(counts.flags).padStart(6), String(counts.helpful).padStart(8),
      `${percent(counts.helpful, counts.flags)}%`.padStart(9), String(counts.cleanFlags).padStart(6),
    ].join(' '));
  const header = `${'rule'.padEnd(34)} ${'kind'.padEnd(14)}  flags  helpful  fixPrec%  clean`;
  return [`JFLEG ${label} by rule`, header, ...rows].join('\n');
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

async function evaluateWordList(suite: Suite, name: string, file: string, engine: Checker): Promise<void> {
  const path = resolve(birkbeckDirectory, file);
  if (!existsSync(path)) {
    suite.out[name] = { skipped: `missing ${path}` };
    return;
  }
  const pairs = parseMisspellingList(await readFile(path, 'utf8'))
    .filter((pair) => !suite.holdoutOnly || pair.split === 'holdout');
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
  suite.out[name] = { tune: rates(counts.tune), holdout: rates(counts.holdout), holdoutMisses: misses };
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

async function evaluateJfleg(suite: Suite, split: 'dev' | 'test', label: Split): Promise<void> {
  if (suite.holdoutOnly && label === 'tune') return;
  const sourcePath = resolve(jflegDirectory, `${split}.src`);
  if (!existsSync(sourcePath)) {
    suite.out[`jfleg-${label}`] = { skipped: `missing ${sourcePath}` };
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
  const byRule = new Map<string, RuleCounts>();
  const falseAlarms: string[] = [];
  for (const reference of references) {
    for (const sentence of reference) {
      cleanSentences += 1;
      const issues = await suite.american.lint(sentence);
      if (issues.length === 0) continue;
      flaggedCleanSentences += 1;
      cleanFlags += issues.length;
      for (const issue of issues) {
        cleanByRule.set(issue.ruleId, (cleanByRule.get(issue.ruleId) ?? 0) + 1);
        const counts = ruleCounts(byRule, issue);
        counts.cleanFlags += 1;
        if (counts.cleanExamples.length < RULE_EXAMPLES) counts.cleanExamples.push(`${sentence} [${issueSummary(issue)}]`);
      }
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
    const issues = await suite.american.lint(source);
    if (needsEdits && issues.length > 0) sentencesFlagged += 1;
    for (const issue of issues) {
      const fix = issue.replacements[0];
      if (fix === undefined) continue;
      flags += 1;
      const counts = ruleCounts(byRule, issue);
      counts.flags += 1;
      const edited = `${source.slice(0, issue.range.start)}${fix}${source.slice(issue.range.end)}`;
      const after = Math.min(...refs.map((ref) => tokenDistance(words(edited), words(ref))));
      if (after < baseline) {
        helpfulFixes += 1;
        counts.helpful += 1;
      } else {
        if (unhelpful.length < FAILURE_EXAMPLES) unhelpful.push(`${source} [${issueSummary(issue)}]`);
        if (counts.unhelpfulExamples.length < RULE_EXAMPLES) counts.unhelpfulExamples.push(`${source} [${issueSummary(issue)}]`);
      }
    }
  }

  console.log(ruleTable(label, byRule));
  suite.out[`jfleg-${label}`] = {
    rules: Object.fromEntries([...byRule].map(([rule, counts]) => [rule, { ...counts, fixPrecisionPct: percent(counts.helpful, counts.flags) }])),
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

async function evaluateHolbrook(suite: Suite): Promise<void> {
  const path = resolve(birkbeckDirectory, 'holbrook-tagged.dat');
  if (!existsSync(path)) {
    suite.out.holbrook = { skipped: `missing ${path}` };
    return;
  }
  const counts = emptyCounts();
  let spellingFlags = 0;
  let spellingFlagsOnTaggedErrors = 0;
  const falseAlarms: string[] = [];
  for (const line of parseHolbrook(await readFile(path, 'utf8'))) {
    const issues = await suite.british.lint(line.text);
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
  suite.out.holbrook = {
    taggedErrors: rates(counts),
    spellingFlags,
    spellingPrecisionPct: percent(spellingFlagsOnTaggedErrors, spellingFlags),
    spellingFalseAlarmExamples: falseAlarms,
  };
}

type ContextItem = Readonly<{ text: string; errors: readonly Readonly<{ start: number; end: number; target: string }>[]; split: Split }>;

function letterDistance(left: string, right: string): number {
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

/** Misspellings marked inside whole sentences: caught, and the right word first or in the top three. */
async function evaluateInContext(suite: Suite, name: string, items: readonly ContextItem[]): Promise<void> {
  const counts: Record<Split, Counts> = { tune: emptyCounts(), holdout: emptyCounts() };
  const misses: string[] = [];
  for (const item of items) {
    if (suite.holdoutOnly && item.split === 'tune') continue;
    const engine = suite.american;
    const issues = await engine.lint(item.text);
    const bucket = counts[item.split];
    for (const error of item.errors) {
      bucket.total += 1;
      const issue = issues.find((candidate) => candidate.range.start < error.end && error.start < candidate.range.end);
      const suggestions = (issue?.replacements ?? []).map((value) => value.toLocaleLowerCase('en'));
      if (issue !== undefined) bucket.detected += 1;
      if (suggestions[0] === error.target) bucket.topOne += 1;
      if (suggestions.slice(0, 3).includes(error.target)) bucket.topThree += 1;
      else if (misses.length < FAILURE_EXAMPLES && item.split === 'holdout') {
        misses.push(`${item.text.slice(error.start, error.end)} → want ${error.target}; got ${suggestions.slice(0, 3).join(', ') || '∅'}`);
      }
    }
  }
  suite.out[name] = { tune: rates(counts.tune), holdout: rates(counts.holdout), holdoutMisses: misses };
}

/**
 * LexNorm2015 tweets (MultiLexNorm copy): one "raw<TAB>normalised" token per line, a blank line between
 * tweets. Only real misspellings are scored: one word for one word, close in spelling. Slang written out
 * in full ("lol" → "laughing out loud") is left out, because Wordwarden should not change it.
 */
async function evaluateLexnorm(suite: Suite): Promise<void> {
  const files = Object.freeze([['train', 'tune'], ['dev', 'tune'], ['test', 'holdout']] as const);
  if (!existsSync(resolve(lexnormDirectory, 'test.norm'))) {
    suite.out.twitter = { skipped: `missing ${lexnormDirectory}` };
    return;
  }
  const items: ContextItem[] = [];
  for (const [file, split] of files) {
    const path = resolve(lexnormDirectory, `${file}.norm`);
    if (!existsSync(path)) continue;
    for (const tweet of (await readFile(path, 'utf8')).split(/\r?\n\s*\r?\n/u)) {
      let text = '';
      const errors: { start: number; end: number; target: string }[] = [];
      for (const line of tweet.split(/\r?\n/u)) {
        const [raw = '', normalised = ''] = line.split('\t');
        if (raw.length === 0) continue;
        if (text.length > 0) text += ' ';
        const start = text.length;
        text += raw;
        const word = /^[a-z']{3,}$/u;
        // The dataset rewrites one slang spelling into a slur; that is never a fix to score.
        const slurRewrite = raw.startsWith('nigg');
        if (raw !== normalised && !slurRewrite && word.test(raw) && word.test(normalised) &&
          letterDistance(raw, normalised) <= 2) {
          errors.push({ start, end: text.length, target: normalised });
        }
      }
      if (errors.length > 0) items.push(Object.freeze({ text, errors: Object.freeze(errors), split }));
    }
  }
  await evaluateInContext(suite, 'twitter', items);
}

/**
 * Aalto 136M Keystrokes: a fixed sample of typed sentences ("target<TAB>typed" per line), made by
 * scripts/aalto-sample.mjs. A word is a typing mistake when the typed word differs from the target word
 * at the same position. Sentences where words were run together or split are left out.
 */
async function evaluateAalto(suite: Suite): Promise<void> {
  if (!existsSync(aaltoSample)) {
    suite.out.aalto = { skipped: `missing ${aaltoSample}` };
    return;
  }
  const bare = (word: string): string => word.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '').toLocaleLowerCase('en');
  const items: ContextItem[] = [];
  for (const line of await readLines(aaltoSample)) {
    const [target = '', typed = ''] = line.split('\t');
    const targetWords = target.trim().split(/\s+/u);
    const typedWords = typed.trim().split(/\s+/u);
    if (targetWords.length !== typedWords.length) continue;
    let text = '';
    const errors: { start: number; end: number; target: string }[] = [];
    typedWords.forEach((word, index) => {
      if (text.length > 0) text += ' ';
      const start = text.length;
      text += word;
      const wanted = bare(targetWords[index] ?? '');
      const got = bare(word);
      if (wanted.length > 0 && got.length > 0 && wanted !== got && /^[\p{L}']+$/u.test(wanted)) {
        const offset = word.toLocaleLowerCase('en').indexOf(got);
        errors.push({ start: start + Math.max(0, offset), end: start + Math.max(0, offset) + got.length, target: wanted });
      }
    });
    if (errors.length > 0) items.push(Object.freeze({ text, errors: Object.freeze(errors), split: splitFor(line) }));
  }
  await evaluateInContext(suite, 'aalto', items);
}

async function evaluateSpeed(suite: Suite): Promise<void> {
  const path = resolve(jflegDirectory, 'dev.ref0');
  if (!existsSync(path)) return;
  const sentences = (await readLines(path)).map(detokenize);
  let text = '';
  for (const sentence of sentences) {
    if (text.split(/\s+/u).length >= 500) break;
    text += `${sentence} `;
  }
  await suite.american.lint(text);
  const timings: number[] = [];
  for (let run = 0; run < 7; run += 1) {
    const started = performance.now();
    await suite.american.lint(text);
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  suite.out.speed = { words: text.split(/\s+/u).length - 1, medianMs: Math.round(timings[3] ?? 0) };
}

function findLanguageToolJar(): string | null {
  if (!existsSync(languageToolDirectory)) return null;
  const folders = [languageToolDirectory, ...readdirSync(languageToolDirectory)
    .filter((name) => name.startsWith('LanguageTool-'))
    .map((name) => resolve(languageToolDirectory, name))];
  return folders.map((folder) => resolve(folder, 'languagetool-server.jar')).find((jar) => existsSync(jar)) ?? null;
}

// On Windows, `java` on the PATH is often a launcher that starts the real java.exe as a separate process, so
// the server is started with the real one, and stopping it also ends anything it started.
function javaExecutable(): string {
  const settings = spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8' });
  const home = /java\.home = (.+)/u.exec(`${settings.stderr}${settings.stdout}`)?.[1]?.trim();
  const java = home === undefined ? null : resolve(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  return java !== null && existsSync(java) ? java : 'java';
}

function stopLanguageTool(): void {
  const server = languageTool;
  languageTool = null;
  if (server?.pid === undefined || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
}

/**
 * Starts a LanguageTool server on this computer only (it does not accept outside connections) for the
 * length of the run. It is stopped when the run ends, fails or is interrupted.
 */
async function startLanguageTool(jar: string): Promise<void> {
  languageTool = spawn(javaExecutable(), ['-Xmx1g', '-cp', jar, 'org.languagetool.server.HTTPServer', '--port', String(LANGUAGETOOL_PORT)], {
    stdio: 'ignore',
  });
  process.once('exit', stopLanguageTool);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopLanguageTool();
      process.exit(1);
    });
  }
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${LANGUAGETOOL_PORT}/v2/languages`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  stopLanguageTool();
  throw new Error('LanguageTool did not start within two minutes.');
}

type LanguageToolMatch = Readonly<{
  offset: number;
  length: number;
  replacements: readonly Readonly<{ value: string }>[];
  rule: Readonly<{ id: string; issueType?: string }>;
}>;

function languageToolChecker(language: 'en-US' | 'en-GB'): Checker {
  return Object.freeze({
    async lint(text: string): Promise<readonly WritingIssue[]> {
      const response = await fetch(`http://127.0.0.1:${LANGUAGETOOL_PORT}/v2/check`, {
        method: 'POST',
        body: new URLSearchParams({ text, language }),
      });
      if (!response.ok) throw new Error(`LanguageTool returned ${response.status}.`);
      const { matches } = await response.json() as { matches: readonly LanguageToolMatch[] };
      // Only the fields the benchmarks read are filled in.
      return matches.map((match) => ({
        id: `${match.rule.id}:${match.offset}`,
        ruleId: match.rule.id,
        category: match.rule.issueType === 'misspelling' ? 'spelling' : 'grammar',
        range: { start: match.offset, end: match.offset + match.length },
        originalText: text.slice(match.offset, match.offset + match.length),
        replacements: match.replacements.map((replacement) => replacement.value),
      }) as unknown as WritingIssue);
    },
  });
}

/**
 * Harper on its own, as the harper.js package ships it: its own engine file, dictionary and default rules,
 * without Wordwarden's spelling ranker, word lists and extra rules. Shows what Wordwarden adds on top.
 */
function plainHarperChecker(dialect: Dialect): Checker & Readonly<{ dispose(): Promise<void> }> {
  const linter = new LocalLinter({ binary: binaryInlined, dialect });
  return Object.freeze({
    async lint(text: string): Promise<readonly WritingIssue[]> {
      const groups = await linter.organizedLints(text, { language: 'plaintext' });
      // Only the fields the benchmarks read are filled in.
      return Object.entries(groups).flatMap(([ruleId, lints]) => lints.map((lint) => {
        const span = lint.span();
        const kind = lint.lint_kind().toLowerCase();
        return {
          id: `${ruleId}:${span.start}`,
          ruleId,
          category: kind === 'spelling' || kind === 'typo' ? 'spelling' : 'grammar',
          range: { start: span.start, end: span.end },
          originalText: text.slice(span.start, span.end),
          replacements: lint.suggestions().map((suggestion) => suggestion.get_replacement_text()),
        } as unknown as WritingIssue;
      }));
    },
    dispose: () => linter.dispose(),
  });
}

async function evaluateAll(suite: Suite): Promise<void> {
  await evaluateWordList(suite, 'birkbeck', 'missp.dat', suite.british);
  await evaluateWordList(suite, 'wikipedia', 'wikipedia.dat', suite.american);
  await evaluateAalto(suite);
  await evaluateLexnorm(suite);
  await evaluateHolbrook(suite);
  await evaluateJfleg(suite, 'dev', 'tune');
  await evaluateJfleg(suite, 'test', 'holdout');
  await evaluateSpeed(suite);
}

beforeAll(async () => {
  [american, british] = await Promise.all([createProductionEngine('american'), createProductionEngine('british')]);
}, 120_000);

afterAll(async () => {
  stopLanguageTool();
  await Promise.all([american?.dispose(), british?.dispose()]);
});

describe('real-world benchmarks', () => {
  it('reports spelling, grammar, false-alarm, and speed results', async () => {
    await evaluateAll(Object.freeze({ out: report, american, british, holdoutOnly: false }));
    const harper = { american: plainHarperChecker(Dialect.American), british: plainHarperChecker(Dialect.British) };
    const harperOut: Report = { version: harperVersion };
    report.harper = harperOut;
    try {
      await evaluateAll(Object.freeze({ out: harperOut, ...harper, holdoutOnly: true }));
    } finally {
      await Promise.all([harper.american.dispose(), harper.british.dispose()]);
    }
    const jar = findLanguageToolJar();
    if (jar === null) {
      report.languagetool = { skipped: `missing languagetool-server.jar in ${languageToolDirectory}` };
    } else {
      await startLanguageTool(jar);
      const out: Report = { version: /LanguageTool-([\d.]+)/u.exec(jar)?.[1] ?? null };
      report.languagetool = out;
      try {
        await evaluateAll(Object.freeze({
          out, american: languageToolChecker('en-US'), british: languageToolChecker('en-GB'), holdoutOnly: true,
        }));
      } finally {
        stopLanguageTool();
      }
    }
    console.log(`WORDWARDEN_BENCHMARK_REPORT=${JSON.stringify(report, null, 2)}`);
    // The accuracy chart is drawn from this file (scripts/accuracy-chart.mjs).
    const reportPath = process.env.WORDWARDEN_BENCHMARK_REPORT;
    if (reportPath !== undefined) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    expect(Object.keys(report).length).toBeGreaterThan(0);
  });
});
