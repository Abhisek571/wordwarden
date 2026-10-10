import american from 'dictionary-en';
import british from 'dictionary-en-gb';
import frequencies from 'subtlex-word-frequencies';
import { binaryInlined } from 'harper.js/binaryInlined';
import type { EnglishDialect } from '#/core/types';
import { createHarperEngine, type HarperEngine } from '#/engines/harper-engine';
import { createSpellingRankerFromData } from '#/engines/spelling-ranker';

const decoder = new TextDecoder();

/** The shipped engine (Harper, local rules, spelling ranker) with bundled data, outside the browser. */
export async function createProductionEngine(dialect: EnglishDialect = 'american'): Promise<HarperEngine> {
  const dictionary = dialect === 'british' ? british : american;
  const engine = createHarperEngine(Object.freeze({
    wasmUrl: binaryInlined.url.toString(),
    createSpellingRanker: async (_dialect, personalWords) => createSpellingRankerFromData(
      Object.freeze({ aff: decoder.decode(dictionary.aff), dic: decoder.decode(dictionary.dic) }),
      frequencies,
      personalWords,
    ),
  }));
  await engine.setup(dialect, Object.freeze([]));
  return engine;
}
