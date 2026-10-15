import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '#/core/settings';
import type { WordwardenCore } from '#/engines/wordwarden-core';
import { createEngineService } from '#/engines/engine-service';

function fakeEngine(log: string[]): WordwardenCore {
  let dialect = '';
  return Object.freeze({
    setup: vi.fn(async (next: string, words: readonly string[]) => {
      dialect = next;
      log.push(`setup ${next} ${words.join(',')}`);
    }),
    addWords: vi.fn(async (words: readonly string[]) => { log.push(`add ${words.join(',')}`); }),
    lint: vi.fn(async (text: string) => {
      log.push(`lint ${dialect} ${text}`);
      return Object.freeze([]);
    }),
    dispose: vi.fn(async () => { log.push(`dispose ${dialect}`); }),
  }) as unknown as WordwardenCore;
}

describe('shared engine service', () => {
  it('starts one engine for every check while the settings stay the same', async () => {
    const log: string[] = [];
    const create = vi.fn(() => fakeEngine(log));
    const service = createEngineService(create);
    await Promise.all([
      service.lint('one', DEFAULT_SETTINGS),
      service.lint('two', DEFAULT_SETTINGS),
      service.lint('three', DEFAULT_SETTINGS),
    ]);
    expect(create).toHaveBeenCalledOnce();
    expect(log).toEqual(['setup american ', 'lint american one', 'lint american two', 'lint american three']);
  });

  it('replaces the engine when the dialect changes and adds new dictionary words to it', async () => {
    const log: string[] = [];
    const service = createEngineService(() => fakeEngine(log));
    await service.lint('a', DEFAULT_SETTINGS);
    await service.lint('b', mergeSettings(DEFAULT_SETTINGS, { dialect: 'british' }));
    await service.lint('c', mergeSettings(DEFAULT_SETTINGS, { dialect: 'british', dictionary: ['Zorbleton'] }));
    // Other settings, such as colours, keep the same engine.
    await service.lint('d', mergeSettings(DEFAULT_SETTINGS, {
      dialect: 'british', dictionary: ['Zorbleton'], colorVision: 'red-green',
    }));
    expect(log).toEqual([
      'setup american ', 'lint american a',
      'dispose american', 'setup british ', 'lint british b',
      'add Zorbleton', 'lint british c',
      'lint british d',
    ]);
  });

  it('replaces the engine when a word is removed or differs from one only in capitals', async () => {
    const log: string[] = [];
    const service = createEngineService(() => fakeEngine(log));
    await service.lint('a', mergeSettings(DEFAULT_SETTINGS, { dictionary: ['Zorbleton'] }));
    await service.lint('b', DEFAULT_SETTINGS);
    await service.lint('c', mergeSettings(DEFAULT_SETTINGS, { dictionary: ['zorbleton'] }));
    await service.lint('d', mergeSettings(DEFAULT_SETTINGS, { dictionary: ['Zorbleton', 'zorbleton'] }));
    expect(log).toEqual([
      'setup american Zorbleton', 'lint american a',
      'dispose american', 'setup american ', 'lint american b',
      'add zorbleton', 'lint american c',
      'dispose american', 'setup american Zorbleton,zorbleton', 'lint american d',
    ]);
  });

  it('tries a new engine after one fails to start', async () => {
    let attempts = 0;
    const service = createEngineService(() => {
      attempts += 1;
      const engine = fakeEngine([]);
      if (attempts === 1) (engine.setup as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no wasm'));
      return engine;
    });
    await expect(service.lint('x', DEFAULT_SETTINGS)).rejects.toThrow('no wasm');
    await expect(service.lint('x', DEFAULT_SETTINGS)).resolves.toEqual([]);
    expect(attempts).toBe(2);
  });
});
