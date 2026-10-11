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

function textControlRects(
  element: HTMLInputElement | HTMLTextAreaElement,
  range: TextRange,
): readonly DOMRect[] {
  const outer = document.createElement('div');
  const mirror = document.createElement('div');
  const marker = document.createElement('span');
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

  mirror.append(document.createTextNode(element.value.slice(0, range.start)));
  marker.textContent = element.value.slice(range.start, range.end) || '\u200b';
  mirror.append(marker, document.createTextNode(element.value.slice(range.end)));
  outer.append(mirror);
  document.documentElement.append(outer);
  const rects = Object.freeze(Array.from(marker.getClientRects(), (rect) => new DOMRect(
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  )));
  outer.remove();
  return rects;
}

function applyTextControl(
  element: HTMLInputElement | HTMLTextAreaElement,
  range: TextRange,
  replacement: string,
  revision: number,
): ApplyResult {
  element.focus();
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

// Editors may swap ordinary spaces for no-break spaces while redrawing.
function comparable(text: string): string {
  return text.replace(/ /gu, ' ');
}

async function applyContentEditable(
  element: HTMLElement,
  range: TextRange,
  replacement: string,
  revision: number,
): Promise<ApplyResult> {
  const declined = Object.freeze({ applied: false, revision });
  const before = buildTextModel(element).text;
  const domRange = rangeForOffsets(element, range);
  if (domRange === null) return declined;
  const selection = element.ownerDocument.getSelection();
  if (selection === null) return declined;
  element.focus();
  selection.removeAllRanges();
  selection.addRange(domRange);
  await selectionSettled(element.ownerDocument);
  if (buildTextModel(element).text !== before) return declined;
  const applied = element.ownerDocument.execCommand('insertText', false, replacement);
  if (!applied) return declined;
  // Some editors redraw the field after the input event; check what they ended up with.
  await nextTask();
  const expected = before.slice(0, range.start) + replacement + before.slice(range.end);
  const after = buildTextModel(element).text;
  if (comparable(after) !== comparable(expected)) {
    // The editor put the text somewhere else. Undo it rather than leave a mangled sentence, but only when
    // something changed: an undo with nothing inserted would remove the writer's own last edit.
    if (after !== before) element.ownerDocument.execCommand('undo');
    return declined;
  }
  return Object.freeze({ applied: true, revision: revision + 1 });
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
    rangeToRects: (range: TextRange): readonly DOMRect[] => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return textControlRects(element, range);
      }
      const domRange = rangeForOffsets(element, range);
      return domRange === null
        ? Object.freeze([])
        : Object.freeze(Array.from(domRange.getClientRects()));
    },
    applySuggestion: (
      range: TextRange,
      replacement: string,
      revision: number,
    ): Promise<ApplyResult> =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? Promise.resolve(applyTextControl(element, range, replacement, revision))
        : applyContentEditable(element, range, replacement, revision),
  });
}
