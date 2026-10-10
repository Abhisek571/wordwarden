import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorEffectQueue } from '#/core/effect-queue';

describe('editor effect queue', () => {
  afterEach(() => vi.useRealTimers());

  it('runs only the latest effect with the same name', () => {
    vi.useFakeTimers();
    const queue = createEditorEffectQueue();
    const first = vi.fn();
    const latest = vi.fn();
    queue.schedule(100, first);
    queue.schedule(100, latest);
    vi.advanceTimersByTime(100);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it('cancels all pending work when disposed', () => {
    vi.useFakeTimers();
    const queue = createEditorEffectQueue();
    const lint = vi.fn();
    const completion = vi.fn();
    queue.schedule(10, lint);
    queue.schedule(10, completion);
    queue.dispose();
    queue.schedule(10, completion);
    vi.runAllTimers();
    expect(lint).not.toHaveBeenCalled();
    expect(completion).not.toHaveBeenCalled();
  });
});
