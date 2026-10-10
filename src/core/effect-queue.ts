export type EditorEffectQueue = Readonly<{
  schedule(delayMs: number, run: () => void): void;
  cancel(): void;
  dispose(): void;
}>;

export function createEditorEffectQueue(): EditorEffectQueue {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function cancel(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function schedule(delayMs: number, run: () => void): void {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError('Effect delay must be a finite non-negative number.');
    }
    if (disposed) return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      run();
    }, delayMs);
  }

  function dispose(): void {
    disposed = true;
    cancel();
  }

  return Object.freeze({ schedule, cancel, dispose });
}
