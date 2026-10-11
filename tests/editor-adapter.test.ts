import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorAdapter } from '#/editors/editor-adapter';

describe('editor adapter contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // happy-dom has no native editing history; the browser suite verifies Undo/Redo.
    document.execCommand = vi.fn((_command, _showUi, replacement) => {
      const element = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
      element.setRangeText(replacement ?? '', element.selectionStart ?? 0, element.selectionEnd ?? 0, 'end');
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replacement }));
      return true;
    });
  });

  it('declines correction when native insertion is unavailable', async () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'wrods';
    document.body.append(textarea);
    document.execCommand = vi.fn(() => false);
    const inputListener = vi.fn();
    textarea.addEventListener('input', inputListener);
    expect(await createEditorAdapter(textarea).applySuggestion({ start: 0, end: 5 }, 'words', 2))
      .toEqual({ applied: false, revision: 2 });
    expect(textarea.value).toBe('wrods');
    expect(inputListener).not.toHaveBeenCalled();
  });

  it('captures and replaces textarea content with an input event', async () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'This are wrong.';
    textarea.setSelectionRange(4, 4);
    document.body.append(textarea);
    const inputListener = vi.fn();
    textarea.addEventListener('input', inputListener);
    const adapter = createEditorAdapter(textarea);

    const captured = adapter.capture(3);
    expect(captured.text).toBe('This are wrong.');

    const result = await adapter.applySuggestion({ start: 5, end: 8 }, 'is', 3);
    expect(result).toEqual({ applied: true, revision: 4 });
    expect(textarea.value).toBe('This is wrong.');
    expect(inputListener).toHaveBeenCalledOnce();
  });

  it('preserves Unicode offsets in text controls', async () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'Hello 👋 wrld';
    document.body.append(input);
    const adapter = createEditorAdapter(input);
    const start = input.value.indexOf('wrld');
    await adapter.applySuggestion({ start, end: start + 4 }, 'world', 0);
    expect(input.value).toBe('Hello 👋 world');
  });

  it('replaces the right word in a multi-block contenteditable', async () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    root.innerHTML = '<div>First line.</div><div>Second wrods.</div>';
    document.body.append(root);
    document.execCommand = vi.fn((_command, _showUi, replacement) => {
      const range = document.getSelection()!.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(replacement ?? ''));
      return true;
    });
    const adapter = createEditorAdapter(root);
    const text = adapter.capture(0).text;
    expect(text).toBe('First line.\nSecond wrods.');
    const start = text.indexOf('wrods');
    expect(await adapter.applySuggestion({ start, end: start + 5 }, 'words', 0))
      .toEqual({ applied: true, revision: 1 });
    expect(root.textContent).toBe('First line.Second words.');
  });

  it('undoes and declines a fix the editor typed somewhere else', async () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    root.textContent = 'features. which i find';
    document.body.append(root);
    const commands: string[] = [];
    document.execCommand = vi.fn((command, _showUi, replacement) => {
      commands.push(command);
      // Like an editor that types at its old cursor, the end of the text.
      if (command === 'insertText') root.append(document.createTextNode(replacement ?? ''));
      if (command === 'undo') root.textContent = 'features. which i find';
      return true;
    });
    const adapter = createEditorAdapter(root);
    expect(await adapter.applySuggestion({ start: 10, end: 15 }, 'Which', 0)).toEqual({ applied: false, revision: 0 });
    expect(commands).toEqual(['insertText', 'undo']);
    expect(root.textContent).toBe('features. which i find');
  });

  it('declines contenteditable edits across block boundaries', async () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    root.innerHTML = '<div>end</div><div>start</div>';
    document.body.append(root);
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    expect(await createEditorAdapter(root).applySuggestion({ start: 2, end: 5 }, 'x', 0))
      .toEqual({ applied: false, revision: 0 });
    expect(execCommand).not.toHaveBeenCalled();
  });
});
