import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorAdapter, TextRange, WritingIssue } from '#/core/types';
import { createTypeCheckOverlay, type TypeCheckOverlay } from '#/ui/overlay';
import { buildTextModel, rangeForOffsets } from '#/editors/dom-offsets';

function issueAt(index: number): WritingIssue {
  return Object.freeze({
    id: `issue-${index}`,
    source: 'core',
    ruleId: 'SpellCheck',
    range: Object.freeze({ start: index * 10, end: index * 10 + 4 }),
    category: 'spelling',
    message: `Issue ${index}`,
    replacements: Object.freeze(['fix']),
    originalText: 'wors',
    issueHash: `hash-${index}`,
  });
}

/** Each issue's box is placed by `top`, so tests can move them as a scroll would. */
function adapterWithTops(element: HTMLElement, top: (index: number) => number): EditorAdapter {
  return Object.freeze({
    id: 'editor-1',
    element,
    capture: () => Object.freeze({ revision: 0, text: '' }),
    rangesToRects: (ranges: readonly TextRange[]) =>
      ranges.map((range) => Object.freeze([new DOMRect(10, top(range.start / 10), 40, 18)])),
    applySuggestion: () => Promise.resolve(Object.freeze({ applied: true, revision: 1 })),
  });
}

function overlayWithShadow(): { overlay: TypeCheckOverlay; marks: () => HTMLButtonElement[] } {
  const nativeAttachShadow = Element.prototype.attachShadow;
  let shadow: ShadowRoot | null = null;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    shadow = nativeAttachShadow.call(this, { ...init, mode: 'open' });
    return shadow;
  });
  const overlay = createTypeCheckOverlay(Object.freeze({ apply: vi.fn(), ignoreAlways: vi.fn(), addWord: vi.fn() }));
  const marks = (): HTMLButtonElement[] =>
    Array.from((shadow as ShadowRoot | null)?.querySelectorAll<HTMLButtonElement>('[data-testid="issue-mark"]') ?? []);
  return { overlay, marks };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.documentElement.querySelector('#typecheck-root')?.remove();
});

describe('drawing underlines again', () => {
  it('moves the underlines already there instead of making new ones', () => {
    const { overlay, marks } = overlayWithShadow();
    const field = document.createElement('div');
    document.body.append(field);
    const issues = Object.freeze([issueAt(0), issueAt(1), issueAt(2)]);
    overlay.renderIssues(adapterWithTops(field, (index) => 20 + index * 30), issues);
    const first = marks();
    overlay.renderIssues(adapterWithTops(field, (index) => 10 + index * 30), issues);
    const second = marks();
    expect(second).toHaveLength(3);
    expect(second.every((mark, index) => mark === first[index])).toBe(true);
    expect(second.map((mark) => mark.style.top)).toEqual(['6px', '36px', '66px']);
    expect(second.map((mark) => mark.dataset.issueId)).toEqual(['issue-0', 'issue-1', 'issue-2']);
  });

  it('removes the underlines left over when fewer issues are on screen', () => {
    const { overlay, marks } = overlayWithShadow();
    const field = document.createElement('div');
    document.body.append(field);
    overlay.renderIssues(adapterWithTops(field, (index) => 20 + index * 30), Object.freeze([issueAt(0), issueAt(1), issueAt(2)]));
    overlay.renderIssues(adapterWithTops(field, (index) => 20 + index * 30), Object.freeze([issueAt(1)]));
    expect(marks().map((mark) => mark.dataset.issueId)).toEqual(['issue-1']);
  });

  it('opens the card of the issue a reused underline now shows', () => {
    const { overlay, marks } = overlayWithShadow();
    const field = document.createElement('div');
    document.body.append(field);
    overlay.renderIssues(adapterWithTops(field, () => 20), Object.freeze([issueAt(0)]));
    overlay.renderIssues(adapterWithTops(field, () => 20), Object.freeze([issueAt(5)]));
    const [mark] = marks();
    mark?.click();
    expect(mark?.dataset.issueId).toBe('issue-5');
    expect(mark?.classList.contains('underline-hidden')).toBe(true);
  });

  it('draws no underlines for words off the screen', () => {
    const { overlay, marks } = overlayWithShadow();
    const field = document.createElement('div');
    document.body.append(field);
    const below = window.innerHeight + 100;
    overlay.renderIssues(adapterWithTops(field, (index) => (index === 1 ? below : 20)), Object.freeze([issueAt(0), issueAt(1)]));
    expect(marks().map((mark) => mark.dataset.issueId)).toEqual(['issue-0']);
  });
});

describe('a hover card while the page keeps redrawing', () => {
  const pointAt = (clientX: number, clientY: number): void => {
    document.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY }));
  };
  const card = (): HTMLElement | null =>
    document.querySelector('#typecheck-root')?.shadowRoot?.querySelector<HTMLElement>('[data-testid="issue-popover"]') ?? null;

  function hoveredOverlay(): { overlay: TypeCheckOverlay; field: HTMLElement; marks: () => HTMLButtonElement[] } {
    vi.useFakeTimers();
    const { overlay, marks } = overlayWithShadow();
    const field = document.createElement('div');
    document.body.append(field);
    overlay.renderIssues(adapterWithTops(field, () => 20), Object.freeze([issueAt(0)]));
    pointAt(20, 25);
    vi.advanceTimersByTime(180);
    return { overlay, field, marks };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays open and follows its word when the page draws the underlines again', () => {
    const { overlay, field, marks } = hoveredOverlay();
    const opened = card();
    expect(opened).not.toBeNull();
    overlay.renderIssues(adapterWithTops(field, () => 60), Object.freeze([issueAt(0)]));
    expect(card()).toBe(opened);
    expect(marks()[0]?.classList.contains('underline-hidden')).toBe(true);
    expect(Number.parseFloat(opened?.style.top ?? '0')).toBeGreaterThan(60);
    overlay.destroy();
  });

  it('closes when its word leaves the screen', () => {
    const { overlay, field, marks } = hoveredOverlay();
    overlay.renderIssues(adapterWithTops(field, () => window.innerHeight + 100), Object.freeze([issueAt(0)]));
    expect(card()).toBeNull();
    expect(marks()).toHaveLength(0);
    overlay.destroy();
  });

  it('closes when its mistake is gone and another is drawn', () => {
    const { overlay, field, marks } = hoveredOverlay();
    overlay.renderIssues(adapterWithTops(field, () => 20), Object.freeze([issueAt(3)]));
    expect(card()).toBeNull();
    expect(marks()[0]?.classList.contains('underline-hidden')).toBe(false);
    overlay.destroy();
  });
});

describe('finding text offsets in long rich text', () => {
  it('maps offsets in every segment, at their edges, and declines offsets in a break', () => {
    const root = document.createElement('div');
    for (let index = 0; index < 50; index += 1) {
      const paragraph = document.createElement('p');
      paragraph.append(`word${index} `, Object.assign(document.createElement('b'), { textContent: `bold${index}` }));
      root.append(paragraph);
    }
    document.body.append(root);
    const model = buildTextModel(root);
    for (const word of ['word0', 'bold0', 'word25', 'bold25', 'bold49']) {
      const start = model.text.indexOf(word);
      expect(rangeForOffsets(root, { start, end: start + word.length }, model)?.toString()).toBe(word);
    }
    const breakAt = model.text.indexOf('\n');
    expect(rangeForOffsets(root, { start: breakAt - 3, end: breakAt + 3 }, model)).toBeNull();
    expect(rangeForOffsets(root, { start: model.text.length, end: model.text.length + 1 }, model)).toBeNull();
  });

  it('sets the range it is given rather than making a new one', () => {
    const root = document.createElement('div');
    root.textContent = 'one two';
    document.body.append(root);
    const reused = document.createRange();
    expect(rangeForOffsets(root, { start: 4, end: 7 }, buildTextModel(root), reused)).toBe(reused);
    expect(reused.toString()).toBe('two');
  });
});
