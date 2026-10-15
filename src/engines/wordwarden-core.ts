import { browser } from 'wxt/browser';
import loadCoreModule, { Checker, Dialect } from '../../core/dist/wordwarden_core.js';
import type { EnglishDialect, IssueCategory, WritingIssue } from '#/core/types';
import { issueHash } from '#/core/hash';
import { excludeIssuesOverlappingSpelling, resolveOverlappingIssues } from '#/core/issue-ranges';
import { isPopularVocabularyWord, mergePopularVocabulary } from '#/core/popular-vocabulary';
import { supplementGrammarIssues } from '#/engines/grammar-rules';
import { createAnalysisSections, rebaseSectionRange, type AnalysisSection } from '#/engines/text-sections';
import {
  areNeighbourKeys,
  createSpellingRanker,
  editDistance,
  rankIssueReplacements,
  type SpellingRanker,
  type WordContext,
} from '#/engines/spelling-ranker';

export type WordwardenCore = Readonly<{
  setup(dialect: EnglishDialect, dictionary: readonly string[]): Promise<void>;
  /** Adds personal words to the engine already set up, as if they had been in the dictionary given to `setup`. */
  addWords(words: readonly string[]): Promise<void>;
  lint(text: string): Promise<readonly WritingIssue[]>;
  dispose(): Promise<void>;
}>;

/**
 * Allows automated checks to provide the same packaged runtime assets from a
 * non-extension environment. The browser extension uses the default URLs.
 */
export type WordwardenCoreRuntime = Readonly<{
  wasmUrl?: string;
  createSpellingRanker?: (
    dialect: EnglishDialect,
    dictionary: readonly string[],
  ) => Promise<SpellingRanker>;
  loadExtraWords?: (dialect: EnglishDialect) => Promise<readonly string[]>;
}>;

const EXTRA_WORD_STEMS: Readonly<Record<EnglishDialect, string>> = Object.freeze({
  american: 'en', australian: 'en-au', canadian: 'en-ca', british: 'en-gb',
});

/** The bundled list of less common words (SCOWL size 70) that the dialect's dictionary leaves out. */
export function extraWordsPath(dialect: EnglishDialect): string {
  return `spelling/extra-${EXTRA_WORD_STEMS[dialect]}.txt`;
}

export function parseExtraWords(text: string): readonly string[] {
  return Object.freeze(text.split(/\r?\n/u).filter((word) => word.length > 0));
}

async function fetchExtraWords(dialect: EnglishDialect): Promise<readonly string[]> {
  const path = extraWordsPath(dialect);
  const response = await fetch((browser.runtime.getURL as (assetPath: string) => string)(path));
  if (!response.ok) {
    throw new Error(
      `Could not load bundled spelling asset ${path}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return parseExtraWords(await response.text());
}

/** One finding of the core's rules, as `Checker.check` returns it, with UTF-16 positions in the checked text. */
type CoreFinding = Readonly<{
  rule: string;
  start: number;
  end: number;
  kind: string;
  message: string;
  suggestions: readonly string[];
}>;

// The core's code is loaded once per page or worker, and every checker shares it. A failed load is tried again.
let coreModule: Promise<unknown> | null = null;

function loadCore(wasmUrl: string): Promise<unknown> {
  coreModule ??= loadCoreModule({ module_or_path: wasmUrl }).catch((error: unknown) => {
    coreModule = null;
    throw error;
  });
  return coreModule;
}

function coreDialect(dialect: EnglishDialect): Dialect {
  if (dialect === 'british') return Dialect.British;
  if (dialect === 'australian') return Dialect.Australian;
  if (dialect === 'canadian') return Dialect.Canadian;
  return Dialect.American;
}

function issueCategory(kind: string): IssueCategory {
  const normalized = kind.toLowerCase();
  if (normalized === 'spelling' || normalized === 'typo') return 'spelling';
  if (normalized === 'punctuation' || normalized === 'formatting') return 'punctuation';
  if (normalized === 'capitalization') return 'capitalization';
  if (normalized === 'style' || normalized === 'readability') return 'style';
  return 'grammar';
}

const SUPPORTED_PUNCTUATION = /[',.?-]/gu;
const UNSUPPORTED_PUNCTUATION = /[^\p{L}\p{N}\s',.?-]/u;

function isSupportedPunctuationReplacement(original: string, replacement: string): boolean {
  if (UNSUPPORTED_PUNCTUATION.test(original) || UNSUPPORTED_PUNCTUATION.test(replacement)) {
    return false;
  }
  const originalWithoutSupportedPunctuation = original.replace(SUPPORTED_PUNCTUATION, '');
  const replacementWithoutSupportedPunctuation = replacement.replace(SUPPORTED_PUNCTUATION, '');
  return originalWithoutSupportedPunctuation === replacementWithoutSupportedPunctuation && (
    original !== originalWithoutSupportedPunctuation || replacement !== replacementWithoutSupportedPunctuation
  );
}

// Local rules that replace an overlapping core suggestion, e.g. "to loose weight" → "lose", not "too loose".
const SUPERSEDING_RULES = new Set(['LoseNotLoose']);

// Core rules turned off: on the JFLEG tune set their fixes almost never matched a human correction and
// they mostly fired on corrected text (style preferences like the Oxford comma, "very good" → "excellent",
// "non-stop" → "nonstop", "petrol" → "gas", or guesses like "most urban" → "urbanest").
const MUTED_CORE_RULES: Readonly<Record<string, boolean>> = Object.freeze({
  AvoidAndAlso: false,
  CompoundNouns: false,
  DisjointPrefixes: false,
  Excellent: false,
  // Sections used to cut long sentences, so it never fired; it only says a sentence is long.
  LongSentences: false,
  MassNouns: false,
  MissingPreposition: false,
  MissingTo: false,
  ModalBeAdjective: false,
  MoreAdjective: false,
  OxfordComma: false,
  Regionalisms: false,
  WouldNeverHave: false,
});

// The core can return "AN" for "A apple"; a single capital means sentence case, not shouting.
function matchShoutedCase(original: string, replacement: string): string {
  const shouted = replacement.length > 1 &&
    replacement === replacement.toLocaleUpperCase('en') &&
    replacement !== replacement.toLocaleLowerCase('en');
  const originalShouted = original.length > 1 && original === original.toLocaleUpperCase('en');
  if (!shouted || originalShouted) return replacement;
  const lower = replacement.toLocaleLowerCase('en');
  const first = original[0];
  return first !== undefined && first !== first.toLocaleLowerCase('en')
    ? `${lower.slice(0, 1).toLocaleUpperCase('en')}${lower.slice(1)}`
    : lower;
}

// The core's OrthographicConsistency rule flags a capital at the start of a sentence ("Who's there?").
function isSentenceCaseOnlyChange(issue: WritingIssue, text: string): boolean {
  if (issue.ruleId !== 'OrthographicConsistency') return false;
  const [replacement] = issue.replacements;
  if (replacement === undefined) return false;
  if (replacement.toLocaleLowerCase('en') !== issue.originalText.toLocaleLowerCase('en')) return false;
  return /(?:^|[.!?]\s+)$/u.test(text.slice(0, issue.range.start));
}

// An unknown word with a capital in mid-sentence ("Jeju", "Smallerden") is almost always a name. It is flagged only
// when it is a slip away from a known word: at most two edits, starting with the same letter or one next to it on
// the keyboard ("Wensday", "Amercia", "Wuropean").
function isLikelyName(issue: WritingIssue, text: string): boolean {
  if (issue.category !== 'spelling' || !/^\p{Lu}\p{Ll}+$/u.test(issue.originalText)) return false;
  if (/(?:^\s*|[.!?…]["'”’)\]]*\s+|\n\s*)$/u.test(text.slice(0, issue.range.start))) return false;
  const [best] = issue.replacements;
  if (best === undefined) return true;
  const word = issue.originalText.toLocaleLowerCase('en');
  const suggestion = best.toLocaleLowerCase('en');
  const first = word[0] ?? '';
  const suggestedFirst = suggestion[0] ?? '';
  return (suggestedFirst !== first && !areNeighbourKeys(suggestedFirst, first)) || editDistance(word, suggestion) > 2;
}

// Removing " uh" from "slow, uh, like" would leave "slow,, like", so take the comma after it too.
function fillerSpan(ruleId: string, source: string, start: number, end: number): Readonly<{ start: number; end: number }> {
  const takesComma = ruleId === 'FillerWords' && source[end] === ',' && source.slice(0, start).trimEnd().endsWith(',');
  return Object.freeze({ start, end: takesComma ? end + 1 : end });
}

// The words either side of a misspelling, when only spaces separate them: a comma or full stop breaks the pair.
function wordContext(source: string, start: number, end: number): WordContext {
  const previous = /([\p{L}'’]+)\s+$/u.exec(source.slice(0, start))?.[1];
  const next = /^\s+([\p{L}'’]+)/u.exec(source.slice(end))?.[1];
  const normalize = (word: string): string => word.toLocaleLowerCase('en').replaceAll('’', "'");
  return Object.freeze({
    ...(previous === undefined ? {} : { previous: normalize(previous) }),
    ...(next === undefined ? {} : { next: normalize(next) }),
  });
}

// Only findings in the section's own part are kept: the text around it is there for context, and findings in it
// belong to the neighbouring sections. Those are skipped before their suggestions are ranked.
function normalizeFinding(
  finding: CoreFinding,
  section: AnalysisSection,
  spellingRanker: SpellingRanker,
): WritingIssue | null {
  const source = section.text;
  const ruleId = finding.rule;
  const span = fillerSpan(ruleId, source, finding.start, finding.end);
  if (span.start < section.localRange.start || span.end > section.localRange.end) return null;
  const contextStart = Math.max(0, span.start - 32);
  const contextEnd = Math.min(source.length, span.end + 32);
  const hash = issueHash(ruleId, source.slice(contextStart, contextEnd));
  const category = issueCategory(finding.kind);
  const rankedReplacements = rankIssueReplacements(
    category,
    source.slice(span.start, span.end),
    finding.suggestions,
    spellingRanker,
    wordContext(source, span.start, span.end),
  );
  const original = source.slice(span.start, span.end);
  const replacements = category === 'punctuation'
    ? Object.freeze(rankedReplacements.filter((replacement) => (
      isSupportedPunctuationReplacement(original, replacement)
    )))
    : Object.freeze(rankedReplacements.map((replacement) => matchShoutedCase(original, replacement)));
  return Object.freeze({
    id: `${hash}-${span.start}-${span.end}`,
    source: 'core',
    ruleId,
    range: Object.freeze({ start: span.start, end: span.end }),
    category,
    message: finding.message,
    replacements,
    originalText: source.slice(span.start, span.end),
    issueHash: hash,
  });
}

// Findings per section of text, so text that did not change since the last check is not checked again.
const SECTION_CACHE_SIZE = 256;

export function createWordwardenCore(runtime: WordwardenCoreRuntime = Object.freeze({})): WordwardenCore {
  let checker: Checker | null = null;
  let spellingRanker: SpellingRanker | null = null;
  // Most recently used last.
  const sectionCache = new Map<string, readonly WritingIssue[]>();
  // Changes whenever the words or the engine change, so findings from before are not cached after.
  let generation = 0;

  function forgetFindings(): void {
    generation += 1;
    sectionCache.clear();
  }

  async function setup(dialect: EnglishDialect, dictionary: readonly string[]): Promise<void> {
    forgetFindings();
    checker?.free();
    checker = null;
    spellingRanker = null;
    const wasmUrl = runtime.wasmUrl ?? (browser.runtime.getURL as (path: string) => string)(
      'wordwarden_core_bg.wasm',
    );
    const recognitionVocabulary = mergePopularVocabulary(dictionary);
    const [nextRanker, extraWords] = await Promise.all([
      (runtime.createSpellingRanker ?? createSpellingRanker)(dialect, recognitionVocabulary),
      (runtime.loadExtraWords ?? fetchExtraWords)(dialect),
      loadCore(wasmUrl),
    ]);
    const nextChecker = new Checker(coreDialect(dialect));
    try {
      // The first check sets up what the core builds on first use, so the user's first check is not slower.
      nextChecker.check('');
      // The extra words only stop false alarms; they are too rare to be worth offering as corrections.
      nextChecker.add_words([...recognitionVocabulary, ...extraWords]);
      nextChecker.set_rules(MUTED_CORE_RULES);
    } catch (error) {
      nextChecker.free();
      throw error;
    }
    checker = nextChecker;
    spellingRanker = nextRanker;
  }

  // Popular vocabulary is already known, and a word is added only once, as `mergePopularVocabulary` does in `setup`.
  async function addWords(words: readonly string[]): Promise<void> {
    if (checker === null || spellingRanker === null) {
      throw new Error('Writing correction engine is not initialized.');
    }
    const added = words.filter((word) => !isPopularVocabularyWord(word));
    if (added.length === 0) return;
    forgetFindings();
    spellingRanker.addWords(added);
    checker.add_words([...added]);
  }

  function sectionIssues(
    activeChecker: Checker,
    activeSpellingRanker: SpellingRanker,
    section: AnalysisSection,
  ): readonly WritingIssue[] {
    const key = `${section.localRange.start}:${section.localRange.end}:${section.text}`;
    const cached = sectionCache.get(key);
    if (cached !== undefined) {
      sectionCache.delete(key);
      sectionCache.set(key, cached);
      return cached;
    }
    const startedGeneration = generation;
    const findings = activeChecker.check(section.text) as readonly CoreFinding[];
    const issues = Object.freeze(findings.flatMap((finding) => {
      const issue = normalizeFinding(finding, section, activeSpellingRanker);
      return issue === null ? [] : [issue];
    }));
    if (startedGeneration === generation) {
      sectionCache.set(key, issues);
      if (sectionCache.size > SECTION_CACHE_SIZE) sectionCache.delete(sectionCache.keys().next().value ?? key);
    }
    return issues;
  }

  async function lint(text: string): Promise<readonly WritingIssue[]> {
    if (checker === null || spellingRanker === null) {
      throw new Error('Writing correction engine is not initialized.');
    }
    const activeChecker = checker;
    const activeSpellingRanker = spellingRanker;
    const coreIssues = createAnalysisSections(text).flatMap((section) => (
      sectionIssues(activeChecker, activeSpellingRanker, section).flatMap((localIssue) => {
        const range = rebaseSectionRange(section, localIssue.range);
        if (range === null) return [];
        return [Object.freeze({ ...localIssue, range, originalText: text.slice(range.start, range.end) })];
      })
    ));
    const supportedIssues = coreIssues.filter((issue) => (
      (issue.category !== 'punctuation' || issue.replacements.length > 0) &&
      (issue.category !== 'spelling' || !isPopularVocabularyWord(issue.originalText)) &&
      !isSentenceCaseOnlyChange(issue, text) &&
      !isLikelyName(issue, text)
    ));
    const supplemented = supplementGrammarIssues(
      supportedIssues,
      text,
      activeSpellingRanker.hasPrefixCompletion,
      activeSpellingRanker.wordPairs,
    );
    const superseding = supplemented.filter((issue) => SUPERSEDING_RULES.has(issue.ruleId));
    return resolveOverlappingIssues(
      excludeIssuesOverlappingSpelling(
        supplemented.filter((issue) => issue.source !== 'core' || !superseding.some((rule) => (
          issue.range.start < rule.range.end && rule.range.start < issue.range.end
        ))),
      ),
    );
  }

  async function dispose(): Promise<void> {
    forgetFindings();
    // The core's memory never shrinks, but what the checker held is reused by the next one.
    checker?.free();
    checker = null;
    spellingRanker = null;
  }

  return Object.freeze({ setup, addWords, lint, dispose });
}
