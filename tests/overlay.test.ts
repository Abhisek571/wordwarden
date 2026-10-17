import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorAdapter, WritingIssue } from '#/core/types';
import { createTypeCheckOverlay } from '#/ui/overlay';
import { DEFAULT_CUSTOM_UNDERLINES } from '#/core/settings';

const issue: WritingIssue = Object.freeze({
  id: 'issue-1',
  source: 'core',
  ruleId: 'SpellCheck',
  range: Object.freeze({ start: 0, end: 4 }),
  category: 'spelling',
  message: 'Did you mean to spell “wors” this way?',
  replacements: Object.freeze(['words', 'works', 'wars']),
  originalText: 'wors',
  issueHash: 'hash-1',
});

function editorAdapter(element: HTMLElement): EditorAdapter {
  return Object.freeze({
    id: 'editor-1',
    kind: 'textarea',
    element,
    capture: () =>
      Object.freeze({
        revision: 0,
        text: 'wors',
      }),
    rangesToRects: (ranges: readonly unknown[]) => ranges.map(() => Object.freeze([new DOMRect(10, 10, 40, 18)])),
    applySuggestion: () => Promise.resolve(Object.freeze({ applied: true, revision: 1 })),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.documentElement.querySelector('#typecheck-root')?.remove();
});

describe('issue popover', () => {
  it('closes without removing the issue underline', () => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      init: ShadowRootInit,
    ): ShadowRoot {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });

    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const overlay = createTypeCheckOverlay(
      Object.freeze({
        apply: vi.fn(),
        ignoreAlways: vi.fn(),
        addWord: vi.fn(),
      }),
    );
    overlay.renderIssues(editorAdapter(textarea), Object.freeze([issue]));

    const shadow = capturedShadow as ShadowRoot | null;
    expect(shadow).not.toBeNull();
    const mark = shadow?.querySelector<HTMLButtonElement>('[data-testid="issue-mark"]');
    expect(mark?.style.top).toBe('6px');
    expect(mark?.style.height).toBe('30px');
    mark?.click();
    expect(mark?.classList.contains('underline-hidden')).toBe(true);
    expect(mark?.classList.contains('spelling')).toBe(true);
    const close = shadow?.querySelector<HTMLButtonElement>('[data-testid="close-suggestion"]');
    expect(close?.getAttribute('aria-label')).toBe('Close suggestion');
    close?.click();

    expect(shadow?.querySelector('[data-testid="issue-popover"]')).toBeNull();
    expect(shadow?.querySelectorAll('[data-testid="issue-mark"]')).toHaveLength(1);
    expect(mark?.classList.contains('underline-hidden')).toBe(false);
    expect(overlay.closeIssuePopover()).toBe(false);
    overlay.destroy();
  });

  it('opens on hover and keeps a pinned suggestion open while using its controls', () => {
    vi.useFakeTimers();
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const overlay = createTypeCheckOverlay(Object.freeze({ apply: vi.fn(), ignoreAlways: vi.fn(), addWord: vi.fn() }));
    overlay.renderIssues(editorAdapter(textarea), Object.freeze([issue]));
    const shadow = capturedShadow as ShadowRoot | null;
    const mark = shadow?.querySelector<HTMLButtonElement>('[data-testid="issue-mark"]');
    const pointAt = (clientX: number, clientY: number): void => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY }));
    };
    // The word sits at 10,10 and is 40 by 18; the underline lets the pointer through to it.
    pointAt(20, 15);
    vi.advanceTimersByTime(180);
    expect(shadow?.querySelector('[data-testid="issue-popover"]')).not.toBeNull();
    expect(mark?.classList.contains('underline-hidden')).toBe(true);
    pointAt(300, 300);
    vi.advanceTimersByTime(250);
    expect(shadow?.querySelector('[data-testid="issue-popover"]')).toBeNull();

    pointAt(20, 15);
    vi.advanceTimersByTime(180);
    overlay.followCaret(2);
    pointAt(300, 300);
    vi.advanceTimersByTime(250);
    expect(shadow?.querySelector('[data-testid="issue-popover"]')).not.toBeNull();
    overlay.destroy();
    vi.useRealTimers();
  });

  it('stays open when the pointer moves from the word straight onto the top of the card', () => {
    vi.useFakeTimers();
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const overlay = createTypeCheckOverlay(Object.freeze({ apply: vi.fn(), ignoreAlways: vi.fn(), addWord: vi.fn() }));
    overlay.renderIssues(editorAdapter(textarea), Object.freeze([issue]));
    const shadow = capturedShadow as ShadowRoot | null;
    const pointAt = (clientX: number, clientY: number): void => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY }));
    };
    pointAt(20, 15);
    vi.advanceTimersByTime(180);
    const card = shadow?.querySelector<HTMLElement>('[data-testid="issue-popover"]');
    expect(card).not.toBeNull();
    // The card's top overlaps the bottom of the word's box (the word is 10 to 28 tall).
    vi.spyOn(card as HTMLElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 24, 320, 200));
    pointAt(30, 26);
    card?.dispatchEvent(new Event('pointerenter'));
    pointAt(60, 80);
    vi.advanceTimersByTime(250);
    expect(shadow?.querySelector('[data-testid="issue-popover"]')).not.toBeNull();

    card?.dispatchEvent(new Event('pointerleave'));
    pointAt(400, 400);
    vi.advanceTimersByTime(250);
    expect(shadow?.querySelector('[data-testid="issue-popover"]')).toBeNull();
    overlay.destroy();
    vi.useRealTimers();
  });

  it('shows the original struck through, one main fix, and plain action labels', () => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const overlay = createTypeCheckOverlay(Object.freeze({ apply: vi.fn(), ignoreAlways: vi.fn(), addWord: vi.fn() }));
    const otherIssue = Object.freeze({ ...issue, id: 'issue-2', originalText: 'othr' });
    overlay.renderIssues(editorAdapter(textarea), [issue, otherIssue]);

    const shadow = capturedShadow as ShadowRoot | null;
    const marks = shadow?.querySelectorAll<HTMLButtonElement>('[data-testid="issue-mark"]');
    marks?.[0]?.click();
    const popover = shadow?.querySelector<HTMLElement>('[data-testid="issue-popover"]');

    expect(popover?.querySelector('.category')?.textContent).toBe('Spelling');
    expect(popover?.querySelector('s')?.textContent).toBe('wors');
    expect(popover?.querySelector('.fix b')?.textContent).toBe('words');
    const fixes = popover?.querySelectorAll<HTMLButtonElement>('[data-testid="apply-suggestion"]');
    expect(fixes).toHaveLength(3);
    expect(fixes?.[0]?.classList.contains('current')).toBe(true);
    expect([...(fixes ?? [])].map((fix) => fix.textContent)).toEqual(['words', 'works', 'wars']);
    expect(popover?.querySelector('.message')).toBeNull();
    expect(popover?.textContent).not.toContain('Original:');
    expect(popover?.textContent).not.toContain('Suggested replacement');
    expect(popover?.querySelector('[data-testid="ignore-once"]')).toBeNull();
    expect(popover?.querySelector('[data-testid="ignore-always"]')?.textContent).toBe('Add to ignore list');
    expect(popover?.querySelector('[data-testid="add-word"]')?.textContent).toBe('Add to dictionary');
    expect(marks?.[0]?.classList.contains('underline-hidden')).toBe(true);
    expect(marks?.[1]?.classList.contains('underline-hidden')).toBe(false);
    expect(shadow?.querySelector('style')?.textContent).not.toContain('.ghost');
    overlay.destroy();
  });

  it('previews each option in the sentence and applies it in one click', () => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const apply = vi.fn();
    const overlay = createTypeCheckOverlay(Object.freeze({ apply, ignoreAlways: vi.fn(), addWord: vi.fn() }));
    const text = 'why is he filling uo the drive from same source?';
    const uo = Object.freeze({ ...issue, range: Object.freeze({ start: 18, end: 20 }), originalText: 'uo',
      replacements: Object.freeze(['ufo', 'up', 'quo']) });
    overlay.renderIssues(Object.freeze({ ...editorAdapter(textarea), capture: () => Object.freeze({ revision: 0, text }) }), [uo]);
    const shadow = capturedShadow as ShadowRoot | null;
    shadow?.querySelector<HTMLButtonElement>('[data-testid="issue-mark"]')?.click();
    const popover = shadow?.querySelector<HTMLElement>('[data-testid="issue-popover"]');

    expect(popover?.querySelector('.preview')?.textContent).toBe('why is he filling ufo the drive from same…');
    const [, up] = [...(popover?.querySelectorAll<HTMLButtonElement>('[data-testid="apply-suggestion"]') ?? [])];
    up?.dispatchEvent(new Event('pointerenter'));
    expect(popover?.querySelector('.preview b')?.textContent).toBe('up');
    expect(popover?.querySelector('.fix b')?.textContent).toBe('up');
    up?.dispatchEvent(new Event('pointerleave'));
    expect(popover?.querySelector('.fix b')?.textContent).toBe('ufo');
    up?.click();
    expect(apply).toHaveBeenCalledWith(uo, 'up');
    overlay.destroy();
  });

  it('follows the cursor into a marked word and applies options by number', () => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const apply = vi.fn();
    const overlay = createTypeCheckOverlay(Object.freeze({ apply, ignoreAlways: vi.fn(), addWord: vi.fn() }));
    overlay.setApplyShortcut('Alt');
    overlay.renderIssues(editorAdapter(textarea), Object.freeze([issue]));
    const shadow = capturedShadow as ShadowRoot | null;
    const popover = (): HTMLElement | null | undefined => shadow?.querySelector<HTMLElement>('[data-testid="issue-popover"]');

    overlay.followCaret(9);
    expect(popover()).toBeNull();
    overlay.followCaret(3);
    expect(popover()).not.toBeNull();
    expect(popover()?.querySelector<HTMLButtonElement>('[data-testid="apply-suggestion"]')?.title).toBe('Alt+1');
    overlay.followCaret(9);
    expect(popover()).toBeNull();

    overlay.followCaret(0);
    expect(overlay.applyOption(3)).toBe(false);
    expect(overlay.applyOption(1)).toBe(true);
    expect(apply).toHaveBeenCalledWith(issue, 'works');
    expect(popover()).toBeNull();
    expect(overlay.applyOption(0)).toBe(false);
    overlay.destroy();
  });

  it('shows the chosen animation after a fix, or none', () => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const overlay = createTypeCheckOverlay(Object.freeze({ apply: vi.fn(), ignoreAlways: vi.fn(), addWord: vi.fn() }));
    const shadow = capturedShadow as ShadowRoot | null;
    const applyFirst = (): Element | null | undefined => {
      overlay.renderIssues(editorAdapter(textarea), Object.freeze([issue]));
      overlay.followCaret(0);
      overlay.applyOption(0);
      return shadow?.querySelector('[data-testid="frank"]');
    };
    expect(applyFirst()?.className).toBe('frank');
    shadow?.querySelectorAll('[data-testid="frank"]').forEach((node) => node.remove());
    overlay.setFixEffect('sparkle');
    const sparkle = applyFirst();
    expect(sparkle?.className).toBe('sparkle');
    expect(sparkle?.querySelectorAll('span').length).toBeGreaterThan(0);
    sparkle?.remove();
    overlay.setFixEffect('off');
    expect(applyFirst()).toBeNull();
    overlay.destroy();
  });

  it('switches the page palette for colour-blind writers', () => {
    const overlay = createTypeCheckOverlay(Object.freeze({ apply: vi.fn(), ignoreAlways: vi.fn(), addWord: vi.fn() }));
    const host = document.querySelector<HTMLElement>('#typecheck-root');
    overlay.setColorVision('red-green', DEFAULT_CUSTOM_UNDERLINES);
    expect(host?.dataset.vision).toBe('red-green');
    overlay.setColorVision('custom', { ...DEFAULT_CUSTOM_UNDERLINES, spelling: { color: '#00ff00', line: 'double', thickness: 1 } });
    expect(host?.style.getPropertyValue('--spelling')).toBe('#00ff00');
    expect(host?.style.getPropertyValue('--spelling-line')).toBe('double');
    expect(host?.style.getPropertyValue('--spelling-width')).toBe('3px');
    overlay.setColorVision('custom', { ...DEFAULT_CUSTOM_UNDERLINES, fix: { color: '#aa00ff', line: 'solid', thickness: 4 } });
    expect(host?.style.getPropertyValue('--fix')).toBe('#aa00ff');
    expect(host?.style.getPropertyValue('--fix-stroke')).toBe('3');
    overlay.setColorVision('standard', DEFAULT_CUSTOM_UNDERLINES);
    expect(host?.dataset.vision).toBeUndefined();
    expect(host?.style.getPropertyValue('--spelling')).toBe('');
    overlay.destroy();
  });

  it('explains grammar issues in plain words and leaves spelling to the preview', () => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const overlay = createTypeCheckOverlay(Object.freeze({ apply: vi.fn(), ignoreAlways: vi.fn(), addWord: vi.fn() }));
    const grammarIssue = Object.freeze({
      ...issue,
      id: 'issue-grammar',
      category: 'grammar' as const,
      message: 'The verb should agree with its subject.',
      originalText: 'walk',
      replacements: Object.freeze(['walks']),
    });
    const swapIssue = Object.freeze({ ...issue, id: 'issue-swap', originalText: 'teh', replacements: Object.freeze(['the']) });
    overlay.renderIssues(editorAdapter(textarea), [grammarIssue, swapIssue]);
    const shadow = capturedShadow as ShadowRoot | null;
    const marks = shadow?.querySelectorAll<HTMLButtonElement>('[data-testid="issue-mark"]');

    marks?.[0]?.click();
    let popover = shadow?.querySelector<HTMLElement>('[data-testid="issue-popover"]');
    expect(popover?.querySelector('.message')?.textContent).toBe('The verb should agree with its subject.');
    expect(popover?.querySelector('[data-testid="add-word"]')).toBeNull();

    marks?.[1]?.click();
    popover = shadow?.querySelector<HTMLElement>('[data-testid="issue-popover"]');
    expect(popover?.querySelector('.message')).toBeNull();
    overlay.destroy();
  });

  it('describes space-only fixes in words instead of blank text', () => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const apply = vi.fn();
    const overlay = createTypeCheckOverlay(Object.freeze({ apply, ignoreAlways: vi.fn(), addWord: vi.fn() }));
    const punctuation = { ...issue, category: 'punctuation' as const, message: 'Use a single space between words.' };
    const extraSpace = Object.freeze({ ...punctuation, id: 'issue-extra', originalText: '  ', replacements: Object.freeze([' ']) });
    const missingSpace = Object.freeze({ ...punctuation, id: 'issue-missing', originalText: 'end.Next', replacements: Object.freeze(['end. Next']) });
    const commaSpace = Object.freeze({ ...punctuation, id: 'issue-comma', originalText: 'a ,', replacements: Object.freeze(['a,']) });
    overlay.renderIssues(editorAdapter(textarea), [extraSpace, missingSpace, commaSpace]);
    const shadow = capturedShadow as ShadowRoot | null;
    const marks = shadow?.querySelectorAll<HTMLButtonElement>('[data-testid="issue-mark"]');

    marks?.[0]?.click();
    let popover = shadow?.querySelector<HTMLElement>('[data-testid="issue-popover"]');
    expect(popover?.querySelector('.fix')?.textContent).toBe('Extra space');
    expect(popover?.querySelector('s')).toBeNull();
    const primary = popover?.querySelector<HTMLButtonElement>('.action.current');
    expect(primary?.textContent).toBe('Remove extra space');
    primary?.click();
    expect(apply).toHaveBeenCalledWith(extraSpace, ' ');

    marks?.[1]?.click();
    popover = shadow?.querySelector<HTMLElement>('[data-testid="issue-popover"]');
    expect(popover?.querySelector('.fix')?.textContent).toBe('Missing space');
    expect(popover?.querySelector('.action.current')?.textContent).toBe('Add a space');

    marks?.[2]?.click();
    popover = shadow?.querySelector<HTMLElement>('[data-testid="issue-popover"]');
    expect(popover?.querySelector('.action.current')?.textContent).toBe('Remove extra space');
    overlay.destroy();
  });

  it('does not draw marks for text scrolled outside the field', () => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 60));
    const overlay = createTypeCheckOverlay(Object.freeze({ apply: vi.fn(), ignoreAlways: vi.fn(), addWord: vi.fn() }));
    const scrolled = Object.freeze({ ...editorAdapter(textarea),
      rangesToRects: (ranges: readonly { start: number }[]) => ranges.map((range) => Object.freeze([range.start === 0 ? new DOMRect(10, 20, 40, 18) : new DOMRect(10, 120, 40, 18)])) });
    overlay.renderIssues(scrolled, [issue, Object.freeze({ ...issue, id: 'issue-visible', range: Object.freeze({ start: 5, end: 9 }) })]);
    const shadow = capturedShadow as ShadowRoot | null;
    const marks = shadow?.querySelectorAll<HTMLElement>('[data-testid="issue-mark"]');
    expect(marks).toHaveLength(1);
    expect(marks?.[0]?.dataset.issueId).toBe('issue-visible');
    overlay.destroy();
  });

  it('opens the card above the word when there is no room below', () => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const overlay = createTypeCheckOverlay(Object.freeze({ apply: vi.fn(), ignoreAlways: vi.fn(), addWord: vi.fn() }));
    const bottomAdapter = Object.freeze({
      ...editorAdapter(textarea),
      rangesToRects: (ranges: readonly unknown[]) => ranges.map(() => Object.freeze([new DOMRect(10, window.innerHeight - 40, 40, 18)])),
    });
    overlay.renderIssues(bottomAdapter, [issue]);
    const shadow = capturedShadow as ShadowRoot | null;
    shadow?.querySelector<HTMLButtonElement>('[data-testid="issue-mark"]')?.click();
    const popover = shadow?.querySelector<HTMLElement>('[data-testid="issue-popover"]');
    expect(popover?.style.top).toBe(`${window.innerHeight - 40 - 7 - 200}px`);
    overlay.destroy();
  });

  it('renders spelling and grammar underlines independently', () => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      init: ShadowRootInit,
    ): ShadowRoot {
      capturedShadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return capturedShadow;
    });

    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const overlay = createTypeCheckOverlay(
      Object.freeze({
        apply: vi.fn(),
        ignoreAlways: vi.fn(),
        addWord: vi.fn(),
      }),
    );
    const grammarIssue = Object.freeze({
      ...issue,
      id: 'issue-2',
      category: 'grammar' as const,
    });
    overlay.renderIssues(editorAdapter(textarea), [issue, grammarIssue]);

    const shadow = capturedShadow as ShadowRoot | null;
    const marks = shadow?.querySelectorAll<HTMLButtonElement>('[data-testid="issue-mark"]');
    const styles = shadow?.querySelector('style')?.textContent ?? '';
    expect(marks).toHaveLength(2);
    expect(marks?.[0]?.className).toContain('spelling');
    expect(marks?.[1]?.className).toContain('grammar');
    expect(marks?.[0]?.style.left).toBe('6px');
    expect(marks?.[0]?.style.top).toBe('6px');
    expect(marks?.[0]?.style.height).toBe('30px');
    expect(marks?.[1]?.style.left).toBe('6px');
    expect(marks?.[1]?.style.top).toBe('6px');
    expect(marks?.[1]?.style.width).toBe('48px');
    expect(marks?.[1]?.style.height).toBe('30px');
    expect(marks?.[1]?.style.getPropertyValue('--mark-inline-inset')).toBe('4px');
    expect(marks?.[1]?.style.getPropertyValue('--underline-top')).toBe('25px');
    expect(styles).toContain('var(--spelling-width, 2px) var(--spelling-line, solid) var(--spelling)');
    expect(styles).toContain('var(--grammar-width, 2px) var(--grammar-line, solid) var(--grammar)');
    expect(styles).toContain('var(--style-width, 2px) var(--style-line, dotted) var(--style)');
    expect(styles).toContain('--spelling: #d32f2f');
    expect(styles).toContain('--grammar: #c27600');
    expect(styles).toContain('--style: #1e6fd9');
    expect(styles).not.toContain('border-bottom: 2px wavy');

    marks?.[1]?.click();
    expect(shadow?.querySelector('[data-testid="issue-popover"]')).not.toBeNull();
    overlay.destroy();
  });
});

describe('status badge', () => {
  function openOverlay(): { overlay: ReturnType<typeof createTypeCheckOverlay>; shadow: ShadowRoot } {
    const nativeAttachShadow = Element.prototype.attachShadow;
    let shadow: ShadowRoot | null = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      shadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return shadow;
    });
    const overlay = createTypeCheckOverlay(Object.freeze({ apply: vi.fn(), ignoreAlways: vi.fn(), addWord: vi.fn() }));
    if (shadow === null) throw new Error('Overlay shadow root was not created.');
    return { overlay, shadow };
  }

  it('hides a message by itself after a few seconds', () => {
    vi.useFakeTimers();
    try {
      const { overlay, shadow } = openOverlay();
      const status = (): HTMLElement | null => shadow.querySelector('[data-testid="status"]');
      overlay.showStatus('Could not apply this suggestion safely.');
      expect(status()?.textContent).toBe('Could not apply this suggestion safely.');
      vi.advanceTimersByTime(3_000);
      overlay.showStatus('The text changed.');
      vi.advanceTimersByTime(3_000);
      expect(status()?.textContent).toBe('The text changed.');
      vi.advanceTimersByTime(1_000);
      expect(status()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows checking, clear, and issue-count states inside the editor corner', () => {
    const { overlay, shadow } = openOverlay();
    const editorRect = new DOMRect(100, 100, 300, 120);
    overlay.showBadge(editorRect, 'checking', 0);
    const badge = (): HTMLButtonElement | null => shadow.querySelector('[data-testid="status-badge"]');
    expect(badge()?.dataset.state).toBe('checking');
    expect(badge()?.getAttribute('aria-label')).toBe('Wordwarden: checking…');
    expect(badge()?.style.left).toBe(`${100 + 300 - 24 - 6}px`);
    expect(badge()?.style.top).toBe(`${100 + 120 - 24 - 6}px`);

    overlay.showBadge(editorRect, 'clear', 0);
    expect(badge()?.dataset.state).toBe('clear');
    expect(badge()?.getAttribute('aria-label')).toBe('Wordwarden: no issues');

    overlay.showBadge(editorRect, 'issues', 3);
    expect(badge()?.textContent).toBe('3');
    expect(badge()?.getAttribute('aria-label')).toBe('Wordwarden: 3 suggestions');
    overlay.showBadge(editorRect, 'issues', 1);
    expect(badge()?.getAttribute('aria-label')).toBe('Wordwarden: 1 suggestion');
    overlay.showBadge(editorRect, 'issues', 14);
    expect(badge()?.textContent).toBe('9+');

    // A one-line field gets the small badge in its bottom-right corner, at whole pixels.
    overlay.moveBadge(new DOMRect(100.4, 100.3, 300.2, 40));
    expect(badge()?.hasAttribute('data-compact')).toBe(true);
    expect(badge()?.style.left).toBe(`${Math.round(400.6 - 18 - 3)}px`);
    expect(badge()?.style.top).toBe(`${Math.round(140.3 - 18 - 3)}px`);

    overlay.clear();
    expect(badge()).not.toBeNull();
    overlay.hideBadge();
    expect(badge()).toBeNull();
    overlay.destroy();
  });

  it('opens the first suggestion when the issue badge is clicked', () => {
    const { overlay, shadow } = openOverlay();
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    overlay.renderIssues(editorAdapter(textarea), [issue]);
    overlay.showBadge(new DOMRect(0, 0, 200, 80), 'issues', 1);
    shadow.querySelector<HTMLButtonElement>('[data-testid="status-badge"]')?.click();
    expect(shadow.querySelector('[data-testid="issue-popover"]')).not.toBeNull();
    overlay.destroy();
  });

  it('colours the badge rings by the kinds of mistakes found', () => {
    const { overlay, shadow } = openOverlay();
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const rect = new DOMRect(0, 0, 200, 80);
    const grammarIssue = Object.freeze({ ...issue, id: 'issue-grammar', category: 'grammar' as const });
    const badge = (): HTMLButtonElement | null => shadow.querySelector('[data-testid="status-badge"]');

    overlay.renderIssues(editorAdapter(textarea), [issue]);
    overlay.showBadge(rect, 'issues', 1);
    expect(badge()?.dataset.kinds).toBe('spelling');
    overlay.renderIssues(editorAdapter(textarea), [grammarIssue]);
    overlay.showBadge(rect, 'issues', 1);
    expect(badge()?.dataset.kinds).toBe('grammar');
    overlay.renderIssues(editorAdapter(textarea), [issue, grammarIssue]);
    overlay.showBadge(rect, 'issues', 2);
    expect(badge()?.dataset.kinds).toBe('both');
    overlay.showBadge(rect, 'checking', 0);
    expect(badge()?.dataset.kinds).toBeUndefined();
    overlay.destroy();
  });
});
