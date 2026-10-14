import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import american from 'dictionary-en';
import frequencies from 'subtlex-word-frequencies';
import { harperWasmUrl } from './helpers/harper-wasm';
import { createHarperEngine, type HarperEngine } from '#/engines/harper-engine';
import { createSpellingRankerFromData } from '#/engines/spelling-ranker';
import type { WritingIssue } from '#/core/types';
import { readBundledExtraWords } from './helpers/production-engine';

type Row = Readonly<Record<string, string>>;
type SpellingError = Readonly<{ wrong: string; correct: string; type: string }>;

const datasetDirectory = process.env.TYPECHECK_EVALUATION_DATASET_DIR ?? 'E:/downlode';
const spellingPath = resolve(datasetDirectory, 'synthetic_spelling_correction_5000.csv');
const punctuationPath = resolve(datasetDirectory, 'synthetic_punctuation_restoration_5000.csv');
const decoder = new TextDecoder();
const SUPPORTED_PUNCTUATION_TYPES = new Set(['apostrophe', 'comma', 'period', 'question_mark', 'hyphen']);

function parseCsv(source: string): readonly Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/u, ''));
    rows.push(row);
  }
  const [headers, ...records] = rows;
  if (headers === undefined) return [];
  return Object.freeze(records.map((values) => Object.freeze(Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? '']),
  ))));
}

function applyFirstSuggestions(text: string, issues: readonly WritingIssue[], category?: WritingIssue['category']): string {
  return issues
    .filter((issue) => category === undefined || issue.category === category)
    .filter((issue) => issue.replacements[0] !== undefined)
    .sort((left, right) => right.range.start - left.range.start)
    .reduce((output, issue) => (
      `${output.slice(0, issue.range.start)}${issue.replacements[0] ?? ''}${output.slice(issue.range.end)}`
    ), text);
}

function punctuationSignature(text: string): string {
  return [...text].filter((character) => "',.?-".includes(character)).join('');
}

function hasOnlySupportedPunctuationTypes(types: string): boolean {
  return types.split('+').every((type) => SUPPORTED_PUNCTUATION_TYPES.has(type));
}

function spellingErrors(row: Row): readonly SpellingError[] {
  return Object.freeze(JSON.parse(row.errors_json ?? '[]') as SpellingError[]);
}

function matchingSpellingIssue(issues: readonly WritingIssue[], wrong: string): WritingIssue | undefined {
  return issues.find((issue) => issue.category === 'spelling' && issue.originalText?.toLocaleLowerCase('en') === wrong.toLocaleLowerCase('en'));
}

function displayIssue(issue: WritingIssue | undefined): string {
  if (issue === undefined) return 'no suggestion';
  return issue.replacements.length === 0 ? `${issue.originalText ?? ''} → (no replacement)` : `${issue.originalText ?? ''} → ${issue.replacements.join(' | ')}`;
}

function addRepresentative(
  groups: Map<string, string[]>,
  category: string,
  example: string,
): void {
  const examples = groups.get(category) ?? [];
  if (examples.length < 6) examples.push(example);
  groups.set(category, examples);
}

function reportGroups(groups: ReadonlyMap<string, readonly string[]>): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(Object.fromEntries([...groups.entries()].map(([category, examples]) => [
    category,
    Object.freeze([...examples]),
  ])));
}

async function createProductionEngine(): Promise<HarperEngine> {
  const engine = createHarperEngine(Object.freeze({
    wasmUrl: harperWasmUrl,
    createSpellingRanker: async (_dialect, personalWords) => createSpellingRankerFromData(
      Object.freeze({ aff: decoder.decode(american.aff), dic: decoder.decode(american.dic) }),
      frequencies,
      personalWords,
    ),
    loadExtraWords: readBundledExtraWords,
  }));
  await engine.setup('american', Object.freeze([]));
  return engine;
}

describe('production correction dataset evaluation', () => {
  it('evaluates the actual engine against the supplied spelling and punctuation CSV inputs', async () => {
    const [spellingRows, allPunctuationRows] = await Promise.all([
      readFile(spellingPath, 'utf8').then(parseCsv),
      readFile(punctuationPath, 'utf8').then(parseCsv),
    ]);
    expect(spellingRows).toHaveLength(5_000);
    expect(allPunctuationRows).toHaveLength(5_000);
    const punctuationRows = allPunctuationRows.filter((row) => (
      hasOnlySupportedPunctuationTypes(row.punctuation_types ?? '')
    ));

    const engine = await createProductionEngine();
    try {
      let spellingErrorsTotal = 0;
      let spellingDetected = 0;
      let spellingTopOne = 0;
      let spellingAnySuggestion = 0;
      let spellingFalsePositiveRows = 0;
      let punctuationOnSpellingRows = 0;
      const spellingFailures = new Map<string, string[]>();

      for (const row of spellingRows) {
        const issues = await engine.lint(row.input_text ?? '');
        const expected = spellingErrors(row);
        if (expected.length === 0) {
          if (issues.some((issue) => issue.category === 'spelling')) spellingFalsePositiveRows += 1;
          continue;
        }
        if (issues.some((issue) => issue.category === 'punctuation')) punctuationOnSpellingRows += 1;
        for (const error of expected) {
          spellingErrorsTotal += 1;
          const issue = matchingSpellingIssue(issues, error.wrong);
          if (issue !== undefined) spellingDetected += 1;
          if (issue?.replacements[0]?.toLocaleLowerCase('en') === error.correct.toLocaleLowerCase('en')) spellingTopOne += 1;
          if (issue?.replacements.some((candidate) => candidate.toLocaleLowerCase('en') === error.correct.toLocaleLowerCase('en'))) spellingAnySuggestion += 1;
          if (issue?.replacements[0]?.toLocaleLowerCase('en') !== error.correct.toLocaleLowerCase('en')) {
            const category = issue === undefined
              ? 'missed detection'
              : issue.replacements.some((candidate) => candidate.toLocaleLowerCase('en') === error.correct.toLocaleLowerCase('en'))
                ? 'candidate ranking'
                : 'wrong candidate list';
            addRepresentative(
              spellingFailures,
              category,
              `${error.type}: ${row.input_text} → ${row.target_text} → ${displayIssue(issue)}`,
            );
          }
        }
      }

      let punctuationExactRows = 0;
      let punctuationMissingRows = 0;
      let punctuationIncorrectRows = 0;
      let punctuationUnnecessaryRows = 0;
      let punctuationSuggestedRows = 0;
      const punctuationFailures = new Map<string, string[]>();
      const punctuationByType = new Map<string, { examples: number; exact: number }>();
      for (const row of punctuationRows) {
        const input = row.input_text ?? '';
        const target = row.target_text ?? '';
        const issues = await engine.lint(input);
        const output = applyFirstSuggestions(input, issues, 'punctuation');
        const inputSignature = punctuationSignature(input);
        const targetSignature = punctuationSignature(target);
        const outputSignature = punctuationSignature(output);
        const type = row.punctuation_types ?? 'unknown';
        const typeMetrics = punctuationByType.get(type) ?? { examples: 0, exact: 0 };
        typeMetrics.examples += 1;
        if (issues.some((issue) => issue.category === 'punctuation' && issue.replacements.length > 0)) punctuationSuggestedRows += 1;
        if (outputSignature === targetSignature) {
          punctuationExactRows += 1;
          typeMetrics.exact += 1;
        }
        punctuationByType.set(type, typeMetrics);
        if (outputSignature.length < targetSignature.length) punctuationMissingRows += 1;
        if (outputSignature !== targetSignature) punctuationIncorrectRows += 1;
        if (outputSignature.length > targetSignature.length) punctuationUnnecessaryRows += 1;
        if (outputSignature !== targetSignature) {
          addRepresentative(punctuationFailures, type, `${input} → ${target} → ${output}`);
        }
        void inputSignature;
      }

      const partialWordIssues = await engine.lint('the const');
      const partialWordPunctuation = partialWordIssues.find(
        (issue) => issue.ruleId === 'SentenceEndingPunctuation',
      );
      expect(partialWordPunctuation).toBeUndefined();
      expect(spellingDetected).toBeGreaterThanOrEqual(4_100);
      expect(spellingTopOne).toBeGreaterThanOrEqual(3_880);
      expect(spellingAnySuggestion).toBeGreaterThanOrEqual(4_050);
      expect(spellingFalsePositiveRows).toBe(0);
      expect(punctuationOnSpellingRows).toBe(0);
      expect(punctuationSuggestedRows).toBeGreaterThanOrEqual(900);
      expect(punctuationExactRows).toBeGreaterThanOrEqual(1_800);
      expect(punctuationUnnecessaryRows).toBe(0);
      const report = Object.freeze({
        spelling: {
          examples: spellingRows.length,
          errorUnits: spellingErrorsTotal,
          detected: spellingDetected,
          topOne: spellingTopOne,
          anySuggestion: spellingAnySuggestion,
          falsePositiveRows: spellingFalsePositiveRows,
          validRows: spellingRows.filter((row) => row.error_type === 'none').length,
          punctuationOnSpellingRows,
          representativeFailures: reportGroups(spellingFailures),
        },
        punctuation: {
          examples: punctuationRows.length,
          suggestedRows: punctuationSuggestedRows,
          exactRows: punctuationExactRows,
          missingRows: punctuationMissingRows,
          incorrectRows: punctuationIncorrectRows,
          unnecessaryRows: punctuationUnnecessaryRows,
          byType: Object.freeze(Object.fromEntries([...punctuationByType.entries()].map(([type, metrics]) => [type, Object.freeze(metrics)]))),
          unsupportedRowsExcluded: allPunctuationRows.length - punctuationRows.length,
          representativeFailures: reportGroups(punctuationFailures),
        },
        partialWordProbe: partialWordIssues.map((issue) => ({
          category: issue.category,
          ruleId: issue.ruleId,
          originalText: issue.originalText,
          replacements: issue.replacements,
        })),
      });
      console.log(`TYPECHECK_EVALUATION_REPORT=${JSON.stringify(report)}`);
    } finally {
      await engine.dispose();
    }
  });
});
