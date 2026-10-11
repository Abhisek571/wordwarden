import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '#/core/settings';
import type { HarperEngine } from '#/engines/harper-engine';
import { createEngineService } from '#/engines/engine-service';

function fakeEngine(log: string[]): HarperEngine {
  let dialect = '';
  return Object.freeze({
    setup: vi.fn(async (next: string, words: readonly string[]) => {
      dialect = next;
      log.push(`setup ${next} ${words.join(',')}`);
    }),
    lint: vi.fn(async (text: string) => {
      log.push(`lint ${dialect} ${text}`);
      return Object.freeze([]);
    }),
    dispose: vi.fn(async () => { log.push(`dispose ${dialect}`); }),
  }) as unknown as HarperEngine;
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

  it('replaces the engine when the dialect or dictionary changes', async () => {
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
      'dispose british', 'setup british Zorbleton', 'lint british c',
      'lint british d',
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
