import type { TextRange } from '#/core/types';

type TextSegment = Readonly<{ node: Text; start: number }>;
type DomPoint = Readonly<{ node: Text; offset: number }>;

export type TextModel = Readonly<{ text: string; segments: readonly TextSegment[] }>;

const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'td', 'th', 'tr',
  'ul',
]);

/**
 * Editor text built from DOM text nodes. `<br>` and block boundaries add a synthetic
 * "\n" with no backing node; every other character maps to exactly one text node offset.
 * With `stopAt`, only the text up to and including that text node is read.
 */
export function buildTextModel(root: HTMLElement, stopAt: Node | null = null): TextModel {
  const parts: string[] = [];
  const segments: TextSegment[] = [];
  let length = 0;
  let pendingBreak = false;
  let stopped = false;

  function append(value: string, node: Text | null): void {
    if (pendingBreak && length > 0 && parts.at(-1)?.endsWith('\n') !== true) {
      parts.push('\n');
      length += 1;
    }
    pendingBreak = false;
    if (node !== null) segments.push(Object.freeze({ node, start: length }));
    parts.push(value);
    length += value.length;
  }

  function visit(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (text.data.length > 0) append(text.data, text);
      if (node === stopAt) stopped = true;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.localName === 'br') {
      append('\n', null);
      return;
    }
    const isBlock = BLOCK_ELEMENTS.has(element.localName);
    if (isBlock) pendingBreak = true;
    for (const child of element.childNodes) {
      visit(child);
      if (stopped) return;
    }
    if (isBlock) pendingBreak = true;
  }

  for (const child of root.childNodes) {
    visit(child);
    if (stopped) break;
  }
  return Object.freeze({ text: parts.join(''), segments: Object.freeze(segments) });
}

// Segments are in text order, so the first one that can hold the offset is found by halving: a long text with many
// issues would otherwise walk all its segments for each issue.
function pointAt(model: TextModel, offset: number): DomPoint | null {
  const { segments } = model;
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const segment = segments[middle];
    if (segment !== undefined && segment.start + segment.node.data.length < offset) low = middle + 1;
    else high = middle;
  }
  const segment = segments[low];
  if (segment === undefined || offset < segment.start) return null;
  return Object.freeze({ node: segment.node, offset: offset - segment.start });
}

/** Text offset of the selection start inside `root`, or null when the selection is elsewhere. */
export function selectionOffset(root: HTMLElement): number | null {
  const selection = root.ownerDocument.getSelection();
  const node = selection?.anchorNode;
  if (selection === null || node === null || node === undefined || !root.contains(node)) return null;
  const range = selection.getRangeAt(0);
  // Only the text before the cursor decides its offset.
  const model = buildTextModel(root, range.startContainer);
  const segment = model.segments.find((candidate) => candidate.node === range.startContainer);
  return segment === undefined ? null : segment.start + range.startOffset;
}

/**
 * `model` can be passed in when several ranges are looked up in the same text, and `reuse` to set one DOM range again
 * rather than make one per lookup: the browser updates every live range on each change to the page.
 */
export function rangeForOffsets(
  root: HTMLElement,
  range: TextRange,
  model = buildTextModel(root),
  reuse: Range | null = null,
): Range | null {
  if (range.end < range.start) return null;
  const start = pointAt(model, range.start);
  const end = pointAt(model, range.end);
  if (start === null || end === null) return null;
  const domRange = reuse ?? root.ownerDocument.createRange();
  domRange.setStart(start.node, start.offset);
  domRange.setEnd(end.node, end.offset);
  // A range across a synthetic break would edit text other than the reported issue.
  return domRange.toString() === model.text.slice(range.start, range.end) ? domRange : null;
}
