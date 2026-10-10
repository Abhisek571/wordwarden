import { beforeEach, describe, expect, it } from 'vitest';
import { buildTextModel, rangeForOffsets } from '#/editors/dom-offsets';

function editable(html: string): HTMLElement {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe('contenteditable text model', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('separates blocks and line breaks without leading or trailing breaks', () => {
    expect(buildTextModel(editable('<div>First line.</div><div>Second wrods.</div>')).text)
      .toBe('First line.\nSecond wrods.');
    expect(buildTextModel(editable('One<br>Two')).text).toBe('One\nTwo');
    expect(buildTextModel(editable('<p>A<br></p><p><br></p><p>B</p>')).text).toBe('A\n\nB');
    expect(buildTextModel(editable('Plain <b>bold</b> text')).text).toBe('Plain bold text');
  });

  it('maps model offsets to the matching DOM text after block breaks', () => {
    const root = editable('<div>First line.</div><div>Second wrods.</div>');
    const text = buildTextModel(root).text;
    const start = text.indexOf('wrods');
    expect(rangeForOffsets(root, { start, end: start + 5 })?.toString()).toBe('wrods');
  });

  it('maps ranges spanning inline elements', () => {
    const root = editable('Plain <b>bo</b>ld text');
    const start = buildTextModel(root).text.indexOf('bold');
    expect(rangeForOffsets(root, { start, end: start + 4 })?.toString()).toBe('bold');
  });

  it('declines ranges that cross a synthetic break or leave the text', () => {
    const root = editable('<div>end</div><div>start</div>');
    expect(rangeForOffsets(root, { start: 2, end: 5 })).toBeNull();
    expect(rangeForOffsets(root, { start: 0, end: 99 })).toBeNull();
    expect(rangeForOffsets(root, { start: 3, end: 1 })).toBeNull();
  });
});
