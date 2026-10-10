const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'transaction-amount',
  'transaction-currency',
]);
const ALLOWED_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', '']);

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

  const editable = element.closest<HTMLElement>('[contenteditable="true"], [contenteditable=""]');
  if (editable === null || !isSafeElement(editable)) return null;
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

function isSafeInput(input: HTMLInputElement): boolean {
  if (!ALLOWED_INPUT_TYPES.has(input.type)) return false;
  return isSafeElement(input);
}
