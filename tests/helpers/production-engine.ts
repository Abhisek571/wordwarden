import { readFile } from 'node:fs/promises';
import american from 'dictionary-en';
import british from 'dictionary-en-gb';
import frequencies from 'subtlex-word-frequencies';
import { harperWasmUrl } from './harper-wasm';
import type { EnglishDialect } from '#/core/types';
import {
  createHarperEngine,
  extraWordsPath,
  parseExtraWords,
  type HarperEngine,
} from '#/engines/harper-engine';
import { createSpellingRankerFromData } from '#/engines/spelling-ranker';
import { parseWordPairs, type WordPairs } from '#/engines/word-pairs';

const decoder = new TextDecoder();

/** The shipped supplementary word list, read from the public folder the build copies it from. */
export async function readBundledExtraWords(dialect: EnglishDialect): Promise<readonly string[]> {
  return parseExtraWords(await readFile(new URL(`../../public/${extraWordsPath(dialect)}`, import.meta.url), 'utf8'));
}

/** The shipped word-pair counts, read from the public folder the build copies them from. */
export async function readBundledWordPairs(): Promise<WordPairs> {
  return parseWordPairs(new Uint8Array(await readFile(new URL('../../public/spelling/pairs.bin', import.meta.url))));
}

/** The shipped engine (Harper, local rules, spelling ranker) with bundled data, outside the browser. */
export async function createProductionEngine(dialect: EnglishDialect = 'american'): Promise<HarperEngine> {
  const dictionary = dialect === 'british' ? british : american;
  const engine = createHarperEngine(Object.freeze({
    wasmUrl: harperWasmUrl,
    createSpellingRanker: async (_dialect, personalWords) => createSpellingRankerFromData(
      Object.freeze({ aff: decoder.decode(dictionary.aff), dic: decoder.decode(dictionary.dic) }),
      frequencies,
      personalWords,
      await readBundledWordPairs(),
    ),
    loadExtraWords: readBundledExtraWords,
  }));
  await engine.setup(dialect, Object.freeze([]));
  return engine;
}
