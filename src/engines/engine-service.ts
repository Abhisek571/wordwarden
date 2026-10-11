import type { TypeCheckSettings } from '#/core/settings';
import type { WritingIssue } from '#/core/types';
import { createHarperEngine, type HarperEngine } from './harper-engine';

export type EngineService = Readonly<{
  /** Checks text with an engine set up for these settings, building a new one when they changed. */
  lint(text: string, settings: TypeCheckSettings): Promise<readonly WritingIssue[]>;
}>;

function engineKey(settings: TypeCheckSettings): string {
  return JSON.stringify([settings.dialect, [...settings.dictionary].sort()]);
}

/**
 * One checking engine for every tab. Each tab used to start its own (about 230 MB each); the background now holds
 * a single one and answers checks one at a time, in the order they arrive.
 */
export function createEngineService(createEngine: () => HarperEngine = createHarperEngine): EngineService {
  let current: Readonly<{ key: string; engine: HarperEngine }> | null = null;
  let queue: Promise<void> = Promise.resolve();

  async function engineFor(settings: TypeCheckSettings): Promise<HarperEngine> {
    const key = engineKey(settings);
    if (current?.key === key) return current.engine;
    const previous = current;
    current = null;
    await previous?.engine.dispose();
    const engine = createEngine();
    // A failed setup is not remembered, so the next check tries again.
    await engine.setup(settings.dialect, settings.dictionary);
    current = Object.freeze({ key, engine });
    return engine;
  }

  return Object.freeze({
    lint(text: string, settings: TypeCheckSettings): Promise<readonly WritingIssue[]> {
      const result = queue.then(async () => (await engineFor(settings)).lint(text));
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  });
}
