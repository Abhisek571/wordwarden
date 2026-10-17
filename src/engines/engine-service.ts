import { isPopularVocabularyWord } from '#/core/popular-vocabulary';
import type { TypeCheckSettings } from '#/core/settings';
import type { EnglishDialect, WritingIssue } from '#/core/types';
import { createWordwardenCore, type WordwardenCore } from './wordwarden-core';

export type EngineService = Readonly<{
  /** Checks text with an engine set up for these settings, building a new one when they changed. */
  lint(text: string, settings: TypeCheckSettings): Promise<readonly WritingIssue[]>;
}>;

type CurrentEngine = Readonly<{ dialect: EnglishDialect; words: ReadonlySet<string>; engine: WordwardenCore }>;

const wordKey = (word: string): string => word.toLocaleLowerCase('en');

/**
 * Words added to the personal dictionary go into the running engine. Removing a word, a word that differs from one
 * already there only in capitals, or another dialect needs a new engine.
 */
function wordsToAdd(current: CurrentEngine, settings: TypeCheckSettings): readonly string[] | null {
  if (settings.dialect !== current.dialect) return null;
  const next = new Set(settings.dictionary);
  if ([...current.words].some((word) => !next.has(word))) return null;
  const added = settings.dictionary.filter((word) => !current.words.has(word));
  const keys = new Set([...current.words].map(wordKey));
  for (const word of added) {
    if (keys.has(wordKey(word)) && !isPopularVocabularyWord(word)) return null;
    keys.add(wordKey(word));
  }
  return added;
}

/**
 * One checking engine for every tab. Each tab used to start its own (about 230 MB each); the background now holds
 * a single one and answers checks one at a time, in the order they arrive.
 */
export function createEngineService(createEngine: () => WordwardenCore = createWordwardenCore): EngineService {
  let current: CurrentEngine | null = null;
  let queue: Promise<void> = Promise.resolve();

  async function engineFor(settings: TypeCheckSettings): Promise<WordwardenCore> {
    const added = current === null ? null : wordsToAdd(current, settings);
    if (current !== null && added !== null) {
      if (added.length === 0) return current.engine;
      const { engine } = current;
      // An engine that failed halfway through is not used again.
      current = null;
      try {
        await engine.addWords(added);
      } catch (error) {
        await engine.dispose();
        throw error;
      }
      current = Object.freeze({ dialect: settings.dialect, words: new Set(settings.dictionary), engine });
      return engine;
    }
    const previous = current;
    current = null;
    await previous?.engine.dispose();
    const engine = createEngine();
    // A failed setup is not remembered, so the next check tries again.
    await engine.setup(settings.dialect, settings.dictionary);
    current = Object.freeze({ dialect: settings.dialect, words: new Set(settings.dictionary), engine });
    return engine;
  }

  // An engine whose check failed is not used again: the core may have aborted (see restartCore). One more try with a
  // new engine usually succeeds, since the text that aborted it is skipped from then on.
  async function lintWith(text: string, settings: TypeCheckSettings, retry: boolean): Promise<readonly WritingIssue[]> {
    const engine = await engineFor(settings);
    try {
      return await engine.lint(text);
    } catch (error) {
      if (current?.engine === engine) current = null;
      await engine.dispose().catch(() => undefined);
      if (!retry) throw error;
      return lintWith(text, settings, false);
    }
  }

  return Object.freeze({
    lint(text: string, settings: TypeCheckSettings): Promise<readonly WritingIssue[]> {
      const result = queue.then(() => lintWith(text, settings, true));
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  });
}
