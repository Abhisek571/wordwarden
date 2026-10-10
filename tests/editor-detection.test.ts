import { beforeEach, describe, expect, it } from 'vitest';
import { closestSupportedEditor } from '#/editors/editor-detection';

describe('editor privacy filtering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('supports normal text fields and contenteditable', () => {
    const input = document.createElement('input');
    input.type = 'text';
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(input, editable);
    expect(closestSupportedEditor(input)).toBe(input);
    expect(closestSupportedEditor(editable)).toBe(editable);
  });

  it.each(['section-checkout billing cc-number', 'SECTION-PAYMENT SHIPPING CC-CSC', 'section-login one-time-code'])('rejects tokenized sensitive autocomplete: %s', (autocomplete) => {
    const input = document.createElement('input');
    input.setAttribute('autocomplete', autocomplete);
    document.body.append(input);
    expect(closestSupportedEditor(input)).toBeNull();
  });

  it('rejects sensitive textarea autocomplete and non-editable controls', () => {
    const textarea = document.createElement('textarea');
    textarea.autocomplete = 'one-time-code';
    const readonly = document.createElement('input');
    readonly.readOnly = true;
    const disabled = document.createElement('textarea');
    disabled.disabled = true;
    document.body.append(textarea, readonly, disabled);
    expect(closestSupportedEditor(textarea)).toBeNull();
    expect(closestSupportedEditor(readonly)).toBeNull();
    expect(closestSupportedEditor(disabled)).toBeNull();
  });

  it('rejects passwords, payment fields, one-time codes, and private regions', () => {
    const password = document.createElement('input');
    password.type = 'password';
    const card = document.createElement('input');
    card.type = 'text';
    card.autocomplete = 'cc-number';
    const otp = document.createElement('input');
    otp.type = 'text';
    otp.autocomplete = 'one-time-code';
    const privateRegion = document.createElement('div');
    privateRegion.dataset.typecheckPrivate = '';
    const privateInput = document.createElement('textarea');
    privateRegion.append(privateInput);
    document.body.append(password, card, otp, privateRegion);
    expect(closestSupportedEditor(password)).toBeNull();
    expect(closestSupportedEditor(card)).toBeNull();
    expect(closestSupportedEditor(otp)).toBeNull();
    expect(closestSupportedEditor(privateInput)).toBeNull();
  });

  it.each([
    'cc-name',
    'cc-given-name',
    'cc-additional-name',
    'cc-family-name',
    'cc-type',
    'transaction-currency',
    'section-checkout billing CC-NAME',
  ])('rejects payment autocomplete: %s', (autocomplete) => {
    const input = document.createElement('input');
    input.setAttribute('autocomplete', autocomplete);
    const textarea = document.createElement('textarea');
    textarea.setAttribute('autocomplete', autocomplete);
    document.body.append(input, textarea);
    expect(closestSupportedEditor(input)).toBeNull();
    expect(closestSupportedEditor(textarea)).toBeNull();
  });

  it('rejects semantically read-only, disabled, or inert editors', () => {
    const readonlyEditable = document.createElement('div');
    readonlyEditable.contentEditable = 'true';
    readonlyEditable.setAttribute('aria-readonly', 'true');
    const disabledEditable = document.createElement('div');
    disabledEditable.contentEditable = 'true';
    disabledEditable.setAttribute('aria-disabled', 'true');
    const disabledGroup = document.createElement('div');
    disabledGroup.setAttribute('aria-disabled', 'true');
    const groupedTextarea = document.createElement('textarea');
    disabledGroup.append(groupedTextarea);
    const inertRegion = document.createElement('div');
    inertRegion.setAttribute('inert', '');
    const inertEditable = document.createElement('div');
    inertEditable.contentEditable = 'true';
    inertRegion.append(inertEditable);
    const allowed = document.createElement('div');
    allowed.contentEditable = 'true';
    allowed.setAttribute('aria-readonly', 'false');
    document.body.append(readonlyEditable, disabledEditable, disabledGroup, inertRegion, allowed);

    expect(closestSupportedEditor(readonlyEditable)).toBeNull();
    expect(closestSupportedEditor(disabledEditable)).toBeNull();
    expect(closestSupportedEditor(groupedTextarea)).toBeNull();
    expect(closestSupportedEditor(inertEditable)).toBeNull();
    expect(closestSupportedEditor(allowed)).toBe(allowed);
  });

  it('honours both the original and the Wordwarden private-region attributes', () => {
    const legacy = document.createElement('div');
    legacy.setAttribute('data-typecheck-private', '');
    const legacyField = document.createElement('textarea');
    legacy.append(legacyField);
    const current = document.createElement('div');
    current.setAttribute('data-wordwarden-private', '');
    const currentField = document.createElement('textarea');
    current.append(currentField);
    document.body.append(legacy, current);
    expect(closestSupportedEditor(legacyField)).toBeNull();
    expect(closestSupportedEditor(currentField)).toBeNull();
  });
});
