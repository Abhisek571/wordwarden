const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'transaction-amount',
  'transaction-currency',
]);
// Not email or url fields: they hold addresses, not writing, and the browser cannot select text inside them to apply
// a fix.
const ALLOWED_INPUT_TYPES = new Set(['text', 'search', '']);

// Every cc-* autofill token is payment data, so match the prefix.
function isSensitiveAutocompleteToken(token: string): boolean {
  return token.startsWith('cc-') || SENSITIVE_AUTOCOMPLETE.has(token);
}

export type SupportedEditor = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

export function editorFromEvent(event: Event): SupportedEditor | null {
  const candidate = event.composedPath()[0];
  return candidate instanceof Element ? closestSupportedEditor(candidate) : null;
}

export function closestSupportedEditor(element: Element): SupportedEditor | null {
  if (element instanceof HTMLInputElement) return isSafeInput(element) ? element : null;
  if (element instanceof HTMLTextAreaElement) return isSafeElement(element) ? element : null;

  // "true" in any case, "", and "plaintext-only" are all editable; the nearest attribute decides, so a
  // contenteditable="false" part of an editor is left alone.
  const editable = element.closest<HTMLElement>('[contenteditable]');
  const value = editable?.getAttribute('contenteditable')?.toLowerCase();
  if (editable === null || editable === undefined || !(value === '' || value === 'true' || value === 'plaintext-only')) {
    return null;
  }
  if (!isSafeElement(editable)) return null;
  return editable;
}

export function isSafeElement(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.disabled || element.readOnly || element.matches(':disabled')) return false;
  }
  const autocomplete = (element.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/u);
  if (autocomplete.some(isSensitiveAutocompleteToken)) return false;
  // aria-readonly applies to the element itself; aria-disabled and inert apply to descendants.
  if (element.getAttribute('aria-readonly') === 'true') return false;
  if (
    element.closest(
      '[data-typecheck-private], [data-wordwarden-private], [data-private], [aria-hidden="true"], [aria-disabled="true"], [inert]',
    ) !== null
  ) {
    return false;
  }
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

// Fields that were password fields stay private after a "show password" button turns them into text fields.
const passwordFields = new WeakSet<HTMLInputElement>();

export function rememberPasswordField(input: HTMLInputElement): void {
  passwordFields.add(input);
}

function isSafeInput(input: HTMLInputElement): boolean {
  if (!ALLOWED_INPUT_TYPES.has(input.type) || passwordFields.has(input)) return false;
  if (/pass(?:word)?|pwd/iu.test(`${input.name} ${input.id}`)) return false;
  return isSafeElement(input);
}
