import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorAdapter } from '#/editors/editor-adapter';
import { closestSupportedEditor } from '#/editors/editor-detection';

describe('spellcheck="false"', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves code editors and monospace boxes that ask for no proofing alone', () => {
    document.body.innerHTML = `
      <div class="cm-editor"><div id="code" contenteditable="true" spellcheck="false">const x</div></div>
      <div spellcheck="false"><textarea id="log" style="font-family: Consolas, monospace"></textarea></div>`;
    expect(closestSupportedEditor(document.getElementById('code')!)).toBeNull();
    expect(closestSupportedEditor(document.getElementById('log')!)).toBeNull();
  });

  it('still checks rich editors and chat boxes that set it, and code boxes that do not', () => {
    document.body.innerHTML = `
      <div id="ck" class="ck-editor__editable" contenteditable="true" spellcheck="false">Text</div>
      <textarea id="chat" spellcheck="false" style="font-family: Inter, sans-serif"></textarea>
      <textarea id="mono" style="font-family: monospace"></textarea>`;
    for (const id of ['ck', 'chat', 'mono']) {
      const element = document.getElementById(id)!;
      expect(closestSupportedEditor(element)).toBe(element);
    }
  });

  it('checks a box that asks for proofing inside a part that does not', () => {
    document.body.innerHTML = `
      <div spellcheck="false"><textarea id="notes" spellcheck="true" style="font-family: monospace"></textarea></div>`;
    const element = document.getElementById('notes')!;
    expect(closestSupportedEditor(element)).toBe(element);
  });
});

describe('editors that draw their text from their own model', () => {
  it('give the fix to the editor as a beforeinput event when the browser insertion is undone', async () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    root.textContent = 'I recieve it.';
    document.body.append(root);
    // Like CKEditor 5: the browser's insertion is drawn over at once, and the editor types what beforeinput asks for.
    document.execCommand = vi.fn(() => true);
    root.addEventListener('beforeinput', (event) => {
      if (event.inputType === 'insertText') root.textContent = `I ${event.data ?? ''} it.`;
    });
    const adapter = createEditorAdapter(root);
    expect(await adapter.applySuggestion({ start: 2, end: 9 }, 'receive', 0)).toEqual({ applied: true, revision: 1 });
    expect(root.textContent).toBe('I receive it.');
  });

  it('declines when the editor ignores both', async () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    root.textContent = 'I recieve it.';
    document.body.append(root);
    const commands: string[] = [];
    document.execCommand = vi.fn((command) => { commands.push(command); return true; });
    const adapter = createEditorAdapter(root);
    expect(await adapter.applySuggestion({ start: 2, end: 9 }, 'receive', 0)).toEqual({ applied: false, revision: 0 });
    expect(root.textContent).toBe('I recieve it.');
    expect(commands).toEqual(['insertText']);
  });

  it('does not undo the writer\'s own edit when the editor draws its text back with a no-break space', async () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    root.textContent = 'I recieve it.';
    document.body.append(root);
    const commands: string[] = [];
    document.execCommand = vi.fn((command) => {
      commands.push(command);
      if (command === 'insertText') root.textContent = 'I recieve it.';
      return true;
    });
    const adapter = createEditorAdapter(root);
    expect(await adapter.applySuggestion({ start: 2, end: 9 }, 'receive', 0)).toEqual({ applied: false, revision: 0 });
    expect(commands).toEqual(['insertText']);
  });
});
