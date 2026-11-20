import type {
  ApplyResult,
  EditorAdapter,
  EditorSnapshot,
  TextRange,
} from '#/core/types';
import type { SupportedEditor } from './editor-detection';
import { buildTextModel, rangeForOffsets, selectionOffset } from './dom-offsets';

const ids = new WeakMap<HTMLElement, string>();
let nextId = 1;

function idFor(element: HTMLElement): string {
  const current = ids.get(element);
  if (current !== undefined) return current;
  const id = `typecheck-editor-${nextId}`;
  nextId += 1;
  ids.set(element, id);
  return id;
}

function textControlSnapshot(
  element: HTMLInputElement | HTMLTextAreaElement,
  revision: number,
): EditorSnapshot {
  return Object.freeze({
    revision,
    text: element.value,
  });
}

function contentEditableSnapshot(
  element: HTMLElement,
  revision: number,
): EditorSnapshot {
  return Object.freeze({
    revision,
    text: buildTextModel(element).text,
  });
}

function copyMeasurementStyles(source: HTMLElement, target: HTMLElement): void {
  const style = getComputedStyle(source);
  const properties = [
    'borderBottomWidth',
    'borderLeftWidth',
    'borderRightWidth',
    'borderTopWidth',
    'boxSizing',
    // Right-to-left fields lay their text out from the right edge.
    'direction',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingBottom',
    'paddingLeft',
    'paddingRight',
    'paddingTop',
    'tabSize',
    'textAlign',
    'textIndent',
    'textTransform',
    'wordSpacing',
  ] as const;
  for (const property of properties) target.style[property] = style[property];
}

// One hidden copy of the field's text for all ranges: each copy made and measured on its own lays the page out again.
function textControlRects(
  element: HTMLInputElement | HTMLTextAreaElement,
  ranges: readonly TextRange[],
): readonly (readonly DOMRect[])[] {
  if (ranges.length === 0) return Object.freeze([]);
  const outer = document.createElement('div');
  const mirror = document.createElement('div');
  const bounds = element.getBoundingClientRect();

  Object.assign(outer.style, {
    position: 'fixed',
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    overflow: 'hidden',
    visibility: 'hidden',
    pointerEvents: 'none',
    zIndex: '-2147483648',
  });
  copyMeasurementStyles(element, mirror);
  Object.assign(mirror.style, {
    position: 'absolute',
    left: `${-element.scrollLeft}px`,
    top: `${-element.scrollTop}px`,
    width: `${element.scrollWidth}px`,
    minHeight: `${element.scrollHeight}px`,
    whiteSpace: element instanceof HTMLInputElement ? 'pre' : 'pre-wrap',
    overflowWrap: 'break-word',
  });
  if (element instanceof HTMLInputElement) {
    // A one-line box centres its text vertically; a line as tall as the box puts the copy's text at the same height.
    const style = getComputedStyle(element);
    const contentHeight = element.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
    if (contentHeight > 0) mirror.style.lineHeight = `${contentHeight}px`;
  }

  // The page's own styles must not reach the copy ("html > div { display: none !important }" would leave every word
  // with no size): its inline styles are made !important, which wins over the page's.
  for (const box of [outer, mirror]) {
    box.style.display = 'block';
    for (const name of Array.from(box.style)) box.style.setProperty(name, box.style.getPropertyValue(name), 'important');
  }

  const text = document.createTextNode(element.value);
  mirror.append(text);
  outer.append(mirror);
  document.documentElement.append(outer);
  const measured = document.createRange();
  const rects = Object.freeze(ranges.map((range) => {
    if (range.start < 0 || range.end < range.start || range.end > element.value.length) return Object.freeze([]);
    measured.setStart(text, range.start);
    measured.setEnd(text, range.end);
    return Object.freeze(Array.from(measured.getClientRects(), (rect) => new DOMRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    )));
  }));
  outer.remove();
  return rects;
}

function hasFocus(element: HTMLElement): boolean {
  const active = (element.getRootNode() as Document | ShadowRoot).activeElement;
  // In nested rich editors focus sits on the outermost editable element.
  return element.isConnected && active !== null && (
    active === element || element.contains(active) ||
    (active instanceof HTMLElement && active.isContentEditable && active.contains(element))
  );
}

function applyTextControl(
  element: HTMLInputElement | HTMLTextAreaElement,
  range: TextRange,
  replacement: string,
  revision: number,
): ApplyResult {
  element.focus();
  // A field that was removed or hidden cannot take focus, and the text would go to whatever field has it.
  if (!hasFocus(element)) return Object.freeze({ applied: false, revision });
  element.setSelectionRange(range.start, range.end);
  // Native insertion preserves undo history and emits the host's input event.
  // Do not fall back to setRangeText: it can corrupt the existing undo stack.
  const applied = element.ownerDocument.execCommand('insertText', false, replacement);
  if (!applied) return Object.freeze({ applied: false, revision });
  return Object.freeze({ applied: true, revision: revision + 1 });
}

const SELECTION_WAIT_MS = 50;

/**
 * Editors such as Reddit's keep their own copy of the selection and update it only when the browser reports a
 * selection change, which arrives a moment after the selection moves. Typing before then lands at their old
 * cursor. Waits for that report (or a short timeout when nothing reports), then one more task so the editor's
 * own handler has run.
 */
function selectionSettled(document: Document): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      document.removeEventListener('selectionchange', done);
      window.clearTimeout(timer);
      window.setTimeout(resolve, 0);
    };
    const timer = window.setTimeout(done, SELECTION_WAIT_MS);
    document.addEventListener('selectionchange', done);
  });
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

const SELECT_ATTEMPTS = 3;
const REDRAW_WAIT_MS = 300;
const REDRAW_POLL_MS = 25;

function selectionMatches(selection: Selection, element: HTMLElement, range: TextRange): boolean {
  const expected = rangeForOffsets(element, range);
  if (expected === null || selection.rangeCount !== 1) return false;
  const actual = selection.getRangeAt(0);
  // The same spot can be written as different nodes and offsets, so compare the text and check the two overlap.
  return actual.toString() === expected.toString() &&
    actual.compareBoundaryPoints(Range.END_TO_START, expected) <= 0 &&
    actual.compareBoundaryPoints(Range.START_TO_END, expected) >= 0;
}

// Editors may swap ordinary spaces for no-break spaces while redrawing.
function comparable(text: string): string {
  return text.replace(/ /gu, ' ');
}

async function settledText(element: HTMLElement, expected: string): Promise<string> {
  await nextTask();
  let text = buildTextModel(element).text;
  for (let waited = 0; comparable(text) !== comparable(expected) && waited < REDRAW_WAIT_MS; waited += REDRAW_POLL_MS) {
    await new Promise((resolve) => window.setTimeout(resolve, REDRAW_POLL_MS));
    text = buildTextModel(element).text;
  }
  return text;
}

async function applyContentEditable(
  element: HTMLElement,
  range: TextRange,
  replacement: string,
  revision: number,
): Promise<ApplyResult> {
  const declined = Object.freeze({ applied: false, revision });
  const before = buildTextModel(element).text;
  const selection = element.ownerDocument.getSelection();
  if (selection === null) return declined;
  element.focus();
  if (!hasFocus(element)) return declined;
  if (!await selectWord(element, selection, range, before)) return declined;
  const applied = element.ownerDocument.execCommand('insertText', false, replacement);
  if (!applied) return declined;
  // Some editors redraw the field after the input event, Twitch's a moment later; check what they ended up with.
  const expected = before.slice(0, range.start) + replacement + before.slice(range.end);
  let after = await settledText(element, expected);
  if (comparable(after) === comparable(before)) {
    // CKEditor 5 draws its text again from its own model, undoing the browser's insertion. It takes text from a
    // beforeinput event instead, which the browser does not send for execCommand. An editor that ignores the event
    // is left as it was, since a page-made beforeinput changes nothing by itself.
    if (!await selectWord(element, selection, range, after)) return declined;
    dispatchInsertText(element, replacement);
    after = await settledText(element, expected);
  }
  if (comparable(after) !== comparable(expected)) {
    // The editor put the text somewhere else. Undo it rather than leave a mangled sentence, but only when
    // something changed: an undo with nothing inserted would remove the writer's own last edit.
    if (comparable(after) !== comparable(before)) element.ownerDocument.execCommand('undo');
    return declined;
  }
  return Object.freeze({ applied: true, revision: revision + 1 });
}

/**
 * Selects the range, again until it stays selected: editors such as Twitch's put their old cursor back a moment
 * after getting focus, over the word just selected. False when it will not stay or the text changed meanwhile.
 */
async function selectWord(element: HTMLElement, selection: Selection, range: TextRange, text: string): Promise<boolean> {
  for (let attempt = 0; attempt < SELECT_ATTEMPTS; attempt += 1) {
    const domRange = rangeForOffsets(element, range);
    if (domRange === null) return false;
    selection.removeAllRanges();
    selection.addRange(domRange);
    await selectionSettled(element.ownerDocument);
    if (buildTextModel(element).text !== text) return false;
    if (selectionMatches(selection, element, range)) return true;
  }
  return false;
}

function dispatchInsertText(element: HTMLElement, replacement: string): void {
  element.dispatchEvent(new InputEvent('beforeinput', {
    inputType: 'insertText',
    data: replacement,
    bubbles: true,
    cancelable: true,
    composed: true,
  }));
}

/** Where the writer's cursor is, as a text offset, or null when it cannot be told. */
export function caretOffset(element: HTMLElement): number | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.selectionStart;
  }
  return selectionOffset(element);
}

export function createEditorAdapter(element: SupportedEditor): EditorAdapter {
  const id = idFor(element);
  return Object.freeze({
    id,
    element,
    capture: (revision: number): EditorSnapshot =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? textControlSnapshot(element, revision)
        : contentEditableSnapshot(element, revision),
    rangesToRects: (ranges: readonly TextRange[]): readonly (readonly DOMRect[])[] => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return textControlRects(element, ranges);
      }
      const model = buildTextModel(element);
      const measured = element.ownerDocument.createRange();
      return Object.freeze(ranges.map((range) => {
        const domRange = rangeForOffsets(element, range, model, measured);
        return domRange === null
          ? Object.freeze([])
          : Object.freeze(Array.from(domRange.getClientRects()));
      }));
    },
    applySuggestion: (
      range: TextRange,
      replacement: string,
      revision: number,
    ): Promise<ApplyResult> =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        // A throw (a field type that cannot select) becomes a failed promise, which the caller recovers from.
        ? new Promise((resolve) => { resolve(applyTextControl(element, range, replacement, revision)); })
        : applyContentEditable(element, range, replacement, revision),
  });
}
