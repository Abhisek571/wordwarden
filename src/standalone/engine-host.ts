/**
 * The browser extension's checking engine as a stand-alone program, for the LibreOffice add-on.
 * Run with Node: `node engine-host.cjs <data folder>`. It reads one JSON request per line on stdin and
 * answers each with one JSON line on stdout. Positions are UTF-16 offsets, as in LibreOffice.
 *
 * Requests: {"id": 1, "type": "check", "dialect": "british", "text": "..."}
 *           {"id": 2, "type": "spell", "dialect": "british", "words": ["teh", "the"]}
 *           {"id": 3, "type": "dictionary", "words": ["Wordwarden"]}
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { EnglishDialect, WritingIssue } from '#/core/types';
import { createHarperEngine, extraWordsPath, parseExtraWords, type HarperEngine } from '#/engines/harper-engine';
import { createSpellingRankerFromData } from '#/engines/spelling-ranker';
import { parseWordPairs, type WordPairs } from '#/engines/word-pairs';

const DIALECTS: readonly EnglishDialect[] = ['american', 'british', 'australian', 'canadian'];
const DICTIONARY_STEMS: Readonly<Record<EnglishDialect, string>> = {
  american: 'en', australian: 'en-au', canadian: 'en-ca', british: 'en-gb',
};

const dataDir = process.argv[2] ?? join(__dirname, 'data');
const wasmUrl = `data:application/wasm;base64,${readFileSync(join(dataDir, 'harper_wasm_bg.wasm')).toString('base64')}`;
let frequencies: unknown;
let wordPairs: WordPairs | undefined;

const engines = new Map<EnglishDialect, Promise<HarperEngine>>();
let personalWords: readonly string[] = [];

function engineFor(dialect: EnglishDialect): Promise<HarperEngine> {
  let engine = engines.get(dialect);
  if (engine === undefined) {
    engine = (async () => {
      const stem = DICTIONARY_STEMS[dialect];
      const next = createHarperEngine({
        wasmUrl,
        createSpellingRanker: async (_dialect, words) => {
          frequencies ??= JSON.parse(readFileSync(join(dataDir, 'spelling', 'frequencies.json'), 'utf8'));
          wordPairs ??= parseWordPairs(new Uint8Array(readFileSync(join(dataDir, 'spelling', 'pairs.bin'))));
          return createSpellingRankerFromData(
            {
              aff: readFileSync(join(dataDir, 'spelling', `${stem}.aff`), 'utf8'),
              dic: readFileSync(join(dataDir, 'spelling', `${stem}.dic`), 'utf8'),
            },
            frequencies as Parameters<typeof createSpellingRankerFromData>[1],
            words,
            wordPairs,
          );
        },
        loadExtraWords: async () => parseExtraWords(readFileSync(join(dataDir, extraWordsPath(dialect)), 'utf8')),
      });
      await next.setup(dialect, personalWords);
      return next;
    })();
    engines.set(dialect, engine);
    // A failed start is retried on the next request instead of being remembered.
    engine.catch(() => engines.delete(dialect));
  }
  return engine;
}

function issueOut(issue: WritingIssue) {
  return {
    start: issue.range.start,
    end: issue.range.end,
    category: issue.category,
    rule: issue.ruleId,
    message: issue.message,
    replacements: issue.replacements,
  };
}

async function spell(engine: HarperEngine, word: string) {
  const issues = await engine.lint(word);
  const typo = issues.find((issue) => issue.category === 'spelling' && issue.range.start === 0 && issue.range.end === word.length);
  return typo === undefined ? { valid: true, suggestions: [] } : { valid: false, suggestions: typo.replacements };
}

async function handle(request: Record<string, unknown>): Promise<unknown> {
  if (request.type === 'dictionary') {
    personalWords = Object.freeze((request.words as unknown[]).filter((word): word is string => typeof word === 'string'));
    // Engines are rebuilt with the new words the next time they are needed.
    const previous = [...engines.values()];
    engines.clear();
    await Promise.allSettled(previous.map(async (engine) => (await engine).dispose()));
    return {};
  }
  const dialect = DIALECTS.includes(request.dialect as EnglishDialect) ? request.dialect as EnglishDialect : 'american';
  const engine = await engineFor(dialect);
  if (request.type === 'check') return { issues: (await engine.lint(String(request.text))).map(issueOut) };
  if (request.type === 'spell') {
    const words = (request.words as unknown[]).map(String);
    const results = [];
    for (const word of words) results.push(await spell(engine, word));
    return { results };
  }
  throw new Error(`Unknown request: ${String(request.type)}`);
}

// Requests are answered one at a time, in order.
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  queue = queue.then(async () => {
    let id: unknown = null;
    try {
      const request = JSON.parse(line) as Record<string, unknown>;
      id = request.id;
      process.stdout.write(`${JSON.stringify({ id, ...(await handle(request) as object) })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ id, error: error instanceof Error ? error.message : String(error) })}\n`);
    }
  });
}).on('close', () => process.exit(0));
