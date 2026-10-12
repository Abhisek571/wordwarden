import {
  createBinaryModuleFromUrl,
  Dialect,
  LocalLinter,
  type Lint,
  type LintKind,
} from 'harper.js';
import { browser } from 'wxt/browser';
import type { EnglishDialect, IssueCategory, WritingIssue } from '#/core/types';
import { issueHash } from '#/core/hash';
import { excludeIssuesOverlappingSpelling, resolveOverlappingIssues } from '#/core/issue-ranges';
import { isPopularVocabularyWord, mergePopularVocabulary } from '#/core/popular-vocabulary';
import { supplementGrammarIssues } from '#/engines/grammar-rules';
import { createAnalysisSections, rebaseSectionRange } from '#/engines/text-sections';
import {
  createSpellingRanker,
  rankIssueReplacements,
  type SpellingRanker,
  type WordContext,
} from '#/engines/spelling-ranker';

export type HarperEngine = Readonly<{
  setup(dialect: EnglishDialect, dictionary: readonly string[]): Promise<void>;
  lint(text: string): Promise<readonly WritingIssue[]>;
  dispose(): Promise<void>;
}>;

/**
 * Allows automated checks to provide the same packaged runtime assets from a
 * non-extension environment. The browser extension uses the default URLs.
 */
export type HarperEngineRuntime = Readonly<{
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

function harperDialect(dialect: EnglishDialect): Dialect {
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

// Local rules that replace an overlapping Harper suggestion, e.g. "to loose weight" → "lose", not "too loose".
const SUPERSEDING_RULES = new Set(['LoseNotLoose']);

// Harper rules turned off: on the JFLEG tune set their fixes almost never matched a human correction and
// they mostly fired on corrected text (style preferences like the Oxford comma, "very good" → "excellent",
// "non-stop" → "nonstop", "petrol" → "gas", or guesses like "most urban" → "urbanest").
const MUTED_HARPER_RULES: Readonly<Record<string, boolean>> = Object.freeze({
  AvoidAndAlso: false,
  CompoundNouns: false,
  DisjointPrefixes: false,
  Excellent: false,
  MassNouns: false,
  MissingPreposition: false,
  MissingTo: false,
  ModalBeAdjective: false,
  MoreAdjective: false,
  OxfordComma: false,
  Regionalisms: false,
  WouldNeverHave: false,
});

// Harper can return "AN" for "A apple"; a single capital means sentence case, not shouting.
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

// Harper's OrthographicConsistency flags a capital at the start of a sentence ("Who's there?").
function isSentenceCaseOnlyChange(issue: WritingIssue, text: string): boolean {
  if (issue.ruleId !== 'OrthographicConsistency') return false;
  const [replacement] = issue.replacements;
  if (replacement === undefined) return false;
  if (replacement.toLocaleLowerCase('en') !== issue.originalText.toLocaleLowerCase('en')) return false;
  return /(?:^|[.!?]\s+)$/u.test(text.slice(0, issue.range.start));
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

function normalizeLint(
  ruleId: string,
  lint: Lint,
  source: string,
  spellingRanker: SpellingRanker,
): WritingIssue {
  const harperSpan = lint.span();
  const span = fillerSpan(ruleId, source, harperSpan.start, harperSpan.end);
  const harperReplacements = Object.freeze(
    lint.suggestions().map((suggestion) => suggestion.get_replacement_text()),
  );
  const contextStart = Math.max(0, span.start - 32);
  const contextEnd = Math.min(source.length, span.end + 32);
  const hash = issueHash(ruleId, source.slice(contextStart, contextEnd));
  const kind = lint.lint_kind() as LintKind;
  const category = issueCategory(kind);
  const rankedReplacements = rankIssueReplacements(
    category,
    source.slice(span.start, span.end),
    harperReplacements,
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
    source: 'harper',
    ruleId,
    range: Object.freeze({ start: span.start, end: span.end }),
    category,
    message: lint.message(),
    replacements,
    originalText: source.slice(span.start, span.end),
    issueHash: hash,
  });
}

export function createHarperEngine(runtime: HarperEngineRuntime = Object.freeze({})): HarperEngine {
  let linter: LocalLinter | null = null;
  let spellingRanker: SpellingRanker | null = null;

  async function setup(dialect: EnglishDialect, dictionary: readonly string[]): Promise<void> {
    if (linter !== null) await linter.dispose();
    const wasmUrl = runtime.wasmUrl ?? (browser.runtime.getURL as (path: string) => string)(
      'harper_wasm_bg.wasm',
    );
    const binary = createBinaryModuleFromUrl(wasmUrl, 'full');
    const nextLinter = new LocalLinter({ binary, dialect: harperDialect(dialect) });
    const recognitionVocabulary = mergePopularVocabulary(dictionary);
    let nextRanker: SpellingRanker;
    let extraWords: readonly string[];
    try {
      [nextRanker, extraWords] = await Promise.all([
        (runtime.createSpellingRanker ?? createSpellingRanker)(dialect, recognitionVocabulary),
        (runtime.loadExtraWords ?? fetchExtraWords)(dialect),
        nextLinter.setup(),
      ]);
    } catch (error) {
      await nextLinter.dispose();
      throw error;
    }
    // The extra words only stop false alarms; they are too rare to be worth offering as corrections.
    await nextLinter.importWords([...recognitionVocabulary, ...extraWords]);
    await nextLinter.setLintConfig(MUTED_HARPER_RULES);
    linter = nextLinter;
    spellingRanker = nextRanker;
  }

  async function lint(text: string): Promise<readonly WritingIssue[]> {
    if (linter === null || spellingRanker === null) {
      throw new Error('Writing correction engine is not initialized.');
    }
    const activeLinter = linter;
    const activeSpellingRanker = spellingRanker;
    const harperIssues = (await Promise.all(createAnalysisSections(text).map(async (section) => {
      const groups = await activeLinter.organizedLints(section.text, {
        language: 'plaintext', dedup: false, isolateEnglish: false,
      });
      return Object.entries(groups).flatMap(([ruleId, lints]) => lints.flatMap((item) => {
        const localIssue = normalizeLint(ruleId, item, section.text, activeSpellingRanker);
        const range = rebaseSectionRange(section, localIssue.range);
        if (range === null) return [];
        return [Object.freeze({ ...localIssue, range, originalText: text.slice(range.start, range.end) })];
      }));
    }))).flat();
    const supportedIssues = harperIssues.filter((issue) => (
      (issue.category !== 'punctuation' || issue.replacements.length > 0) &&
      (issue.category !== 'spelling' || !isPopularVocabularyWord(issue.originalText)) &&
      !isSentenceCaseOnlyChange(issue, text)
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
        supplemented.filter((issue) => issue.source !== 'harper' || !superseding.some((rule) => (
          issue.range.start < rule.range.end && rule.range.start < issue.range.end
        ))),
      ),
    );
  }

  async function dispose(): Promise<void> {
    if (linter === null) return;
    await linter.dispose();
    linter = null;
    spellingRanker = null;
  }

  return Object.freeze({ setup, lint, dispose });
}
