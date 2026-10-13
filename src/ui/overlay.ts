import { issueMatchesText } from '#/core/issue-ranges';
import { UNDERLINE_KINDS, type ColorVision, type CustomUnderlines, type FixEffect } from '#/core/settings';
import type { EditorAdapter, IssueCategory, TextRange, WritingIssue } from '#/core/types';

export type OverlayActions = Readonly<{
  apply(issue: WritingIssue, replacement: string): void;
  ignoreAlways(issue: WritingIssue): void;
  addWord(issue: WritingIssue): void;
}>;

export type BadgeState = 'checking' | 'clear' | 'issues';

export type TypeCheckOverlay = Readonly<{
  renderIssues(adapter: EditorAdapter, issues: readonly WritingIssue[]): void;
  showBadge(editorRect: DOMRect, state: BadgeState, count: number): void;
  moveBadge(editorRect: DOMRect): void;
  hideBadge(): void;
  closeIssuePopover(): boolean;
  /** Opens the card for the issue under the writer's cursor, or closes a card the cursor has left. */
  followCaret(offset: number | null): void;
  /** Applies option 1, 2 or 3 of the open card; false when there is no such option. */
  applyOption(index: number): boolean;
  setApplyShortcut(label: string | null): void;
  clear(): void;
  showStatus(message: string): void;
  hideStatus(): void;
  setColorVision(vision: ColorVision, custom: CustomUnderlines): void;
  setFixEffect(effect: FixEffect): void;
  destroy(): void;
}>;

const OVERLAY_STYLES = `
  :host { all: initial; color-scheme: light dark;
    --ink: #1d2433; --ink-2: #4f5768; --paper: #ffffff; --hair: #dde0e6; --wash: #eceef2;
    --spelling: #d32f2f; --grammar: #e08a00; --grammar-ink: #9a5b00; --style: #1e6fd9; --clear: #2f7d5b;
    --focus: #1d2433; --keyline: rgb(29 36 51 / .28); --shadow: 0 2px 6px rgb(17 22 33 / .12);
    --face: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; }
  * { box-sizing: border-box; }
  ::selection { background: rgb(30 99 201 / .22); }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
  /* Underlines let the mouse through, so the word can still be clicked into and selected. */
  .mark { appearance: none; position: fixed; border: 0; background: transparent; overflow: visible;
    pointer-events: none; padding: 0; min-width: 3px; }
  .mark::after { content: ""; position: absolute; left: var(--mark-inline-inset, 0);
    right: var(--mark-inline-inset, 0); pointer-events: none; }
  /* The word whose card is open: a category wash replaces its underline. */
  .mark.underline-hidden::after { display: none; }
  .mark.underline-hidden::before { content: ""; position: absolute; left: var(--mark-inline-inset, 0);
    right: var(--mark-inline-inset, 0); top: 4px; height: calc(var(--underline-top, 20px) - 3px); border-radius: 3px;
    background: color-mix(in srgb, var(--grammar) 18%, transparent); pointer-events: none; }
  .mark.spelling.underline-hidden::before { background: color-mix(in srgb, var(--spelling) 15%, transparent); }
  .mark.style.underline-hidden::before { background: color-mix(in srgb, var(--style) 15%, transparent); }
  .mark.spelling::after { top: var(--underline-top, 0);
    border-top: var(--spelling-width, 2px) var(--spelling-line, solid) var(--spelling); }
  .mark.grammar::after, .mark.capitalization::after, .mark.punctuation::after {
    top: var(--underline-top, 3px); border-top: var(--grammar-width, 2px) var(--grammar-line, solid) var(--grammar); }
  .mark.style::after { top: var(--underline-top, 3px);
    border-top: var(--style-width, 2px) var(--style-line, dotted) var(--style); }
  svg.icon { display: block; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.75;
    stroke-linecap: round; stroke-linejoin: round; }

  .popover { position: fixed; width: min(320px, calc(100vw - 24px)); max-height: min(400px, calc(100vh - 24px));
    overflow-y: auto; pointer-events: auto; border: 1px solid var(--keyline); border-radius: 6px;
    background: var(--paper); color: var(--ink); box-shadow: var(--shadow); padding: 6px 6px 8px;
    font: 400 13px/1.45 var(--face); scrollbar-width: thin; scrollbar-color: var(--hair) transparent; }
  .popover > :not(.summary) { margin-left: 8px; margin-right: 8px; }
  /* The summary: what kind of mistake, the fix, and how the line reads with it. */
  .summary { border-radius: 4px; background: var(--ink); color: var(--paper); padding: 2px 6px 6px 10px; }
  .popover-header { display: flex; align-items: center; gap: 8px; min-height: 24px; }
  .popover { --cat: var(--grammar-ink); }
  .popover.spelling { --cat: var(--spelling); }
  .popover.style { --cat: var(--style); }
  /* Postmark ring: two hairline circles, coloured by issue category. */
  .dot { width: 12px; height: 12px; flex: none; border-radius: 50%; border: 1px solid var(--cat);
    box-shadow: inset 0 0 0 2px var(--paper), inset 0 0 0 3px var(--cat); }
  .summary .dot { box-shadow: inset 0 0 0 2px var(--ink), inset 0 0 0 3px var(--cat); }
  .category { flex: none; color: color-mix(in srgb, var(--cat) 72%, var(--paper)); font-size: 13px; font-weight: 650; }
  .summary { --dim: color-mix(in srgb, var(--paper) 58%, var(--ink)); }
  .popover-header button.close { margin-left: auto; margin-right: -4px; flex: none; width: 24px; height: 24px; color: var(--dim); }
  .popover-header button.close:hover { background: color-mix(in srgb, var(--paper) 14%, var(--ink)); color: var(--paper); }
  .fix { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 6px; margin-left: 4px; min-width: 0;
    font-size: 17px; line-height: 1.25; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .fix s { color: color-mix(in srgb, var(--paper) 78%, var(--ink)); font-size: 14px; text-decoration-color: var(--cat); text-decoration-thickness: 2px; }
  .fix svg.icon { color: var(--dim); }
  .fix b { font-weight: 700; }
  .preview { margin: 2px 0 0; color: var(--dim); white-space: pre-wrap; overflow-wrap: anywhere; }
  .preview b { color: var(--paper); font-weight: 700; text-decoration: underline; text-underline-offset: 3px;
    text-decoration-color: var(--dim); }
  .options-label { margin: 8px 0 0; color: var(--ink-2); font-size: 12px; font-weight: 650; }
  .replacements { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
  button.action { appearance: none; border: 1px solid var(--hair); border-radius: 4px; background: transparent;
    color: var(--ink); padding: 4px 12px; min-height: 28px; font: 500 13px/1.3 var(--face); cursor: pointer;
    transition: border-color .12s ease-out, background-color .12s ease-out; }
  button.action:hover { border-color: var(--ink-2); background: var(--wash); }
  button.action { font-weight: 600; font-size: 14px; }
  button.action.current { border-color: var(--ink-2); }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  button:disabled { cursor: progress; opacity: .6; }
  .message { margin: 6px 0 0; color: var(--ink-2); max-width: 60ch; }
  button.close { appearance: none; display: grid; place-items: center; width: 28px; height: 28px; border: 0;
    border-radius: 4px; background: transparent; color: var(--ink-2); padding: 0; cursor: pointer; }
  button.close:hover { background: var(--wash); color: var(--ink); }
  .secondary { display: flex; gap: 4px 16px; margin-top: 6px; flex-wrap: wrap; }
  button.link { appearance: none; border: 0; background: transparent; color: var(--ink-2); padding: 2px 0;
    font: 500 12px/1.3 var(--face); cursor: pointer; text-underline-offset: 3px; }
  button.link:hover { color: var(--ink); text-decoration: underline; }

  .badge { appearance: none; position: fixed; width: 24px; height: 24px; border: 0; border-radius: 50%;
    padding: 0; display: grid; place-items: center; pointer-events: auto; cursor: pointer;
    background: var(--paper); color: var(--spelling); box-shadow: 0 1px 4px rgb(17 22 33 / .22);
    font: 750 11px/1 var(--face); font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  /* Double postmark ring: solid inner ring, ticked outer ring. */
  .badge::before { content: ""; position: absolute; inset: 3px; border-radius: 50%; border: 1.5px solid currentColor; }
  .badge::after { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 1px solid currentColor; opacity: .5; }
  .badge svg.icon { width: 11px; height: 11px; stroke-width: 2.5; }
  .badge[data-compact] { width: 18px; height: 18px; font-size: 10px; }
  .badge[data-compact]::before { inset: 2px; border-width: 1px; }
  .badge[data-compact] svg.icon { width: 9px; height: 9px; }
  .badge[data-state="checking"] { color: var(--ink-2); cursor: default; }
  /* Checking: the outer ring ticks round like a franking die. */
  .badge[data-state="checking"]::after { border-style: dashed; opacity: .9; animation: spin 2.4s linear infinite; }
  .badge[data-state="checking"]::before { border-color: var(--hair); }
  .badge[data-state="clear"] { color: var(--clear); }
  .badge[data-state="issues"]:hover { box-shadow: 0 2px 8px rgb(17 22 33 / .3); }
  /* The rings show what was found: red for spelling, amber for grammar; both kinds put amber on the outer ring. */
  .badge[data-kinds="grammar"] { color: var(--grammar-ink); }
  .badge[data-kinds="grammar"]::before { border-color: var(--grammar); }
  .badge[data-kinds="both"]::after { border-color: var(--grammar); border-width: 1.5px; opacity: 1; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Franked: cancellation waves stamped over a word when a fix is applied. */
  .frank { position: fixed; pointer-events: none; color: var(--fix, var(--clear)); animation: frank .7s cubic-bezier(.16, 1, .3, 1) forwards; }
  .frank svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: var(--fix-stroke, 1.5);
    stroke-linecap: round; }
  /* Sparkle: little stars burst off the word while a glint sweeps across it. */
  .sparkle { position: fixed; pointer-events: none; color: var(--fix, var(--clear)); }
  .sparkle::before { content: ""; position: absolute; inset: 0; border-radius: 4px;
    background: linear-gradient(100deg, transparent 20%, color-mix(in srgb, currentColor 45%, transparent) 50%, transparent 80%);
    background-size: 250% 100%; animation: glint .7s ease-out forwards; }
  .sparkle span { position: absolute; left: var(--x); top: var(--y); width: var(--s); height: var(--s); margin: calc(var(--s) / -2);
    background: currentColor; clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
    animation: burst .8s cubic-bezier(.16, 1, .3, 1) var(--d) forwards; opacity: 0; }
  @keyframes glint { from { background-position: 100% 0; } to { background-position: -50% 0; opacity: 0; } }
  @keyframes burst { 0% { opacity: 0; transform: translate(0, 0) scale(.2) rotate(0); }
    25% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1) rotate(90deg); } }
  @keyframes frank { 0% { opacity: 0; transform: translateX(-6px); } 18% { opacity: .9; transform: none; }
    100% { opacity: 0; transform: none; } }

  .status { position: fixed; right: 16px; bottom: 16px; pointer-events: none; border-radius: 4px;
    background: var(--ink); color: var(--paper); padding: 8px 12px; font: 600 12px/1.2 var(--face);
    box-shadow: var(--shadow); }
  @media (prefers-reduced-motion: reduce) {
    .badge[data-state="checking"]::after, .frank { animation: none; }
    .frank, .sparkle { display: none; }
    button.action { transition: none; }
  }
  @media (prefers-color-scheme: dark) {
    :host { --ink: #eceef3; --ink-2: #a7aebb; --paper: #1b202b; --hair: #333b4a; --wash: #252b38;
      --spelling: #ff6b6b; --grammar: #ffb340; --grammar-ink: #ffb340; --style: #79a8ff; --clear: #4cc38a;
      --focus: #eceef3; --keyline: rgb(236 238 243 / .3); --shadow: 0 2px 8px rgb(0 0 0 / .45); }
    ::selection { background: rgb(121 168 255 / .3); }
  }
  /* Colour-blind palettes: blue and orange stay apart without red-green vision; red and teal without
     blue-yellow vision. Grammar also gets a dashed underline, so the line shape alone tells them apart. */
  :host([data-vision="red-green"]) { --spelling: #0072b2; --grammar: #e69f00; --grammar-ink: #8a5300; --style: #b8458f; }
  :host([data-vision="blue-yellow"]) { --spelling: #d32f2f; --grammar: #00838f; --grammar-ink: #00727c; --style: #5f6b7a; }
  @media (prefers-color-scheme: dark) {
    :host([data-vision="red-green"]) { --spelling: #56b4e9; --grammar: #e69f00; --grammar-ink: #f0b429; --style: #e08bc4; }
    :host([data-vision="blue-yellow"]) { --spelling: #ff6b6b; --grammar: #4dd0e1; --grammar-ink: #4dd0e1; --style: #a7aebb; }
  }
  :host([data-vision="red-green"]), :host([data-vision="blue-yellow"]) { --grammar-line: dashed; }
`;

const CATEGORY_LABELS: Readonly<Record<IssueCategory, string>> = Object.freeze({
  spelling: 'Spelling',
  grammar: 'Grammar',
  capitalization: 'Capitalization',
  punctuation: 'Punctuation',
  style: 'Style',
});
const BADGE_SIZE = 24;
const BADGE_INSET = 6;
const COMPACT_BADGE_SIZE = 18;
const COMPACT_BADGE_INSET = 3;
const COMPACT_FIELD_HEIGHT = 56;
const POPOVER_GAP = 7;
const VIEWPORT_MARGIN = 12;
const GRAMMAR_MARK_INLINE_PADDING = 4;
const GRAMMAR_MARK_BLOCK_PADDING = 4;
const HOVER_OPEN_DELAY_MS = 180;
// Messages hide themselves after this long, so they never sit over the page.
const STATUS_SHOW_MS = 4_000;
const HOVER_CLOSE_DELAY_MS = 220;

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = Object.freeze({
  close: 'M4 4l8 8M12 4l-8 8',
  arrow: 'M3 8h10M9 4l4 4-4 4',
  check: 'M3 8.5l3.2 3L13 4.5',
});
const FRANK_PATH = 'M0 3q5-3 10 0t10 0 10 0 10 0M0 9q5-3 10 0t10 0 10 0 10 0M0 15q5-3 10 0t10 0 10 0 10 0';
const FRANK_DURATION_MS = 700;
const SPARKLE_COUNT = 9;
const SPARKLE_DURATION_MS = 1000;

function svg(path: string, className: string, viewBox: string): SVGSVGElement {
  const element = document.createElementNS(SVG_NS, 'svg');
  element.setAttribute('viewBox', viewBox);
  element.setAttribute('class', className);
  element.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  element.append(shape);
  return element;
}

function icon(name: keyof typeof ICON_PATHS): SVGSVGElement {
  return svg(ICON_PATHS[name], 'icon', '0 0 16 16');
}

function button(label: string, className: string, testId: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.dataset.testid = testId;
  return element;
}

type SpacingChange = Readonly<{ change: string; action: string }>;

// Spaces are invisible on the card, so describe edits that only add or remove whitespace in words.
function spacingChange(original: string, replacement: string): SpacingChange | null {
  if (original === replacement) return null;
  if (original.replace(/\s/gu, '') !== replacement.replace(/\s/gu, '')) return null;
  const breaksBefore = (original.match(/\n/gu) ?? []).length;
  const breaksAfter = (replacement.match(/\n/gu) ?? []).length;
  if (breaksBefore > breaksAfter) return { change: 'Extra line break', action: 'Remove line break' };
  if (breaksBefore < breaksAfter) return { change: 'Missing line break', action: 'Add line break' };
  const spacesBefore = (original.match(/\s/gu) ?? []).length;
  const spacesAfter = (replacement.match(/\s/gu) ?? []).length;
  if (spacesBefore > spacesAfter) return { change: 'Extra space', action: 'Remove extra space' };
  if (spacesBefore < spacesAfter) return { change: 'Missing space', action: 'Add a space' };
  return { change: 'Different space', action: 'Use a normal space' };
}

// Harper's spelling message only restates the word; the preview already shows the change.
function issueExplanation(issue: WritingIssue): string | null {
  return issue.category === 'spelling' ? null : issue.message;
}

const PREVIEW_CONTEXT = 24;

// A few words either side of the mistake, on its own line, so a fix can be read in place.
function previewContext(text: string, range: TextRange): Readonly<{ before: string; after: string }> | null {
  const lineStart = text.lastIndexOf('\n', range.start - 1) + 1;
  const nextBreak = text.indexOf('\n', range.end);
  const lineEnd = nextBreak < 0 ? text.length : nextBreak;
  const beforeStart = Math.max(lineStart, range.start - PREVIEW_CONTEXT);
  const afterEnd = Math.min(lineEnd, range.end + PREVIEW_CONTEXT);
  let before = text.slice(beforeStart, range.start);
  let after = text.slice(range.end, afterEnd);
  if (beforeStart > lineStart) before = `…${before.replace(/^\S*\s/u, '')}`;
  if (afterEnd < lineEnd) after = `${after.replace(/\s\S*$/u, '')}…`;
  return before.trim().length === 0 && after.trim().length === 0 ? null : Object.freeze({ before, after });
}

export function createTypeCheckOverlay(actions: OverlayActions): TypeCheckOverlay {
  const host = document.createElement('div');
  host.id = 'typecheck-root';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;
  const layer = document.createElement('div');
  layer.className = 'layer';
  shadow.append(style, layer);
  document.documentElement.append(host);

  let issueElements: HTMLElement[] = [];
  let markTargets: Readonly<{ issue: WritingIssue; rect: DOMRect; box: DOMRect }>[] = [];
  let hoveredIssueId: string | null = null;
  let optionButtons: HTMLButtonElement[] = [];
  let shortcutLabel: string | null = null;
  let fixEffect: FixEffect = 'waves';
  let popoverElement: HTMLElement | null = null;
  let statusElement: HTMLElement | null = null;
  let statusTimer = 0;
  let badgeElement: HTMLButtonElement | null = null;
  let firstIssue: Readonly<{ issue: WritingIssue; rect: DOMRect }> | null = null;
  let issueKinds: 'spelling' | 'grammar' | 'both' = 'spelling';
  let hoverTimer: number | null = null;
  let popoverPinned = false;
  let popoverIssueId: string | null = null;
  let currentAdapter: EditorAdapter | null = null;

  function removeElements(elements: readonly HTMLElement[]): void {
    for (const element of elements) element.remove();
  }

  function closePopover(): void {
    if (hoverTimer !== null) window.clearTimeout(hoverTimer);
    hoverTimer = null;
    popoverElement?.remove();
    for (const mark of issueElements) mark.classList.remove('underline-hidden');
    popoverElement = null;
    popoverPinned = false;
    popoverIssueId = null;
    optionButtons = [];
  }

  function closeIssuePopover(): boolean {
    if (popoverElement === null) return false;
    closePopover();
    return true;
  }

  function cancelHoverClose(): void {
    if (hoverTimer !== null) window.clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  function scheduleHoverClose(): void {
    if (popoverPinned) return;
    cancelHoverClose();
    hoverTimer = window.setTimeout(closePopover, HOVER_CLOSE_DELAY_MS);
  }

  function showPopover(issue: WritingIssue, anchor: DOMRect, pinned = false): void {
    if (popoverIssueId === issue.id && popoverElement !== null) {
      if (pinned) popoverPinned = true;
      positionPopover(popoverElement, anchor);
      return;
    }
    closePopover();
    popoverPinned = pinned;
    popoverIssueId = issue.id;
    for (const mark of issueElements) {
      mark.classList.toggle('underline-hidden', mark.dataset.issueId === issue.id);
    }
    const popover = document.createElement('section');
    popover.className = `popover ${issue.category}`;
    popover.dataset.testid = 'issue-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Wordwarden suggestion');

    const dot = document.createElement('span');
    dot.className = `dot ${issue.category}`;
    dot.setAttribute('aria-hidden', 'true');
    const category = document.createElement('span');
    category.className = 'category';
    category.textContent = CATEGORY_LABELS[issue.category];
    const close = button('', 'close', 'close-suggestion');
    close.append(icon('close'));
    close.setAttribute('aria-label', 'Close suggestion');
    close.addEventListener('click', closePopover);
    const header = document.createElement('div');
    header.className = 'popover-header';
    header.append(dot, category);
    const summary = document.createElement('div');
    summary.className = 'summary';
    summary.append(header);
    popover.append(summary);

    const replacements = issue.replacements.slice(0, 3);
    const [best] = replacements;
    if (best !== undefined) {
      const fix = document.createElement('span');
      fix.className = 'fix';
      header.append(fix);
      const text = currentAdapter?.capture(0).text;
      const context = text !== undefined && issueMatchesText(issue, text) ? previewContext(text, issue.range) : null;
      const preview = document.createElement('p');
      preview.className = 'preview';
      const previewWord = document.createElement('b');
      if (context !== null) {
        preview.append(context.before, previewWord, context.after);
        summary.append(preview);
      }

      // The summary shows the chosen fix; hovering another option previews that one instead.
      function showFix(replacement: string): void {
        const spacing = spacingChange(issue.originalText, replacement);
        if (spacing !== null) {
          const label = document.createElement('b');
          label.textContent = spacing.change;
          fix.replaceChildren(label);
        } else {
          const original = document.createElement('s');
          original.textContent = issue.originalText;
          const target = document.createElement('b');
          target.textContent = replacement.length === 0 ? 'remove' : replacement;
          fix.replaceChildren(original, icon('arrow'), target);
        }
        previewWord.textContent = replacement;
      }
      showFix(best);

      const label = document.createElement('p');
      label.className = 'options-label';
      label.textContent = 'Options';
      const options = document.createElement('div');
      options.className = 'replacements';
      for (const replacement of replacements) {
        const option = button(
          spacingChange(issue.originalText, replacement)?.action ?? (replacement.length === 0 ? 'Remove' : replacement),
          replacement === best ? 'action current' : 'action',
          'apply-suggestion',
        );
        option.addEventListener('pointerenter', () => showFix(replacement));
        option.addEventListener('focus', () => showFix(replacement));
        option.addEventListener('pointerleave', () => showFix(best));
        option.addEventListener('blur', () => showFix(best));
        option.addEventListener('click', () => {
          actions.apply(issue, replacement);
          closePopover();
          frank(anchor);
        });
        if (shortcutLabel !== null) option.title = `${shortcutLabel}+${options.childElementCount + 1}`;
        options.append(option);
      }
      optionButtons = [...options.querySelectorAll<HTMLButtonElement>('button')];
      popover.append(label, options);
    }
    header.append(close);
    const explanation = issueExplanation(issue);
    if (explanation !== null) {
      const message = document.createElement('p');
      message.className = 'message';
      message.textContent = explanation;
      summary.after(message);
    }

    const secondary = document.createElement('div');
    secondary.className = 'secondary';
    // Moving away already closes the card, so there is no separate one-off dismiss.
    const ignoreAlways = button('Add to ignore list', 'link', 'ignore-always');
    ignoreAlways.addEventListener('click', () => {
      actions.ignoreAlways(issue);
      closePopover();
    });
    const addWord = button('Add to dictionary', 'link', 'add-word');
    addWord.addEventListener('click', () => {
      actions.addWord(issue);
      closePopover();
    });
    secondary.append(ignoreAlways);
    if (issue.category === 'spelling') secondary.append(addWord);
    popover.addEventListener('pointerenter', cancelHoverClose);
    popover.addEventListener('pointerleave', scheduleHoverClose);
    popover.append(secondary);

    layer.append(popover);
    positionPopover(popover, anchor);
    popoverElement = popover;
  }

  // Stamp cancellation waves over the corrected word, like a franked letter, or let it sparkle.
  function frank(anchor: DOMRect): void {
    if (fixEffect === 'off') return;
    if (fixEffect === 'sparkle') {
      sparkle(anchor);
      return;
    }
    const stamp = document.createElement('div');
    stamp.className = 'frank';
    stamp.dataset.testid = 'frank';
    const height = Math.min(18, Math.max(10, anchor.height * 0.8));
    stamp.style.left = `${anchor.left - 2}px`;
    stamp.style.top = `${anchor.top + anchor.height * 0.58 - height / 2}px`;
    stamp.style.width = `${Math.max(24, anchor.width + 4)}px`;
    stamp.style.height = `${height}px`;
    const waves = svg(FRANK_PATH, '', '0 0 40 18');
    waves.setAttribute('preserveAspectRatio', 'none');
    stamp.append(waves);
    layer.append(stamp);
    window.setTimeout(() => stamp.remove(), FRANK_DURATION_MS);
  }

  function sparkle(anchor: DOMRect): void {
    const burst = document.createElement('div');
    burst.className = 'sparkle';
    burst.dataset.testid = 'frank';
    burst.style.left = `${anchor.left - 2}px`;
    burst.style.top = `${anchor.top}px`;
    burst.style.width = `${Math.max(24, anchor.width + 4)}px`;
    burst.style.height = `${anchor.height}px`;
    for (let index = 0; index < SPARKLE_COUNT; index += 1) {
      const star = document.createElement('span');
      const angle = (index / SPARKLE_COUNT) * Math.PI * 2 + Math.random() * 0.6;
      const reach = 10 + Math.random() * 12;
      star.style.setProperty('--x', `${10 + Math.random() * 80}%`);
      star.style.setProperty('--y', `${30 + Math.random() * 40}%`);
      star.style.setProperty('--dx', `${Math.cos(angle) * reach}px`);
      star.style.setProperty('--dy', `${Math.sin(angle) * reach - 4}px`);
      star.style.setProperty('--s', `${5 + Math.random() * 5}px`);
      star.style.setProperty('--d', `${Math.random() * 120}ms`);
      burst.append(star);
    }
    layer.append(burst);
    window.setTimeout(() => burst.remove(), SPARKLE_DURATION_MS);
  }

  function setFixEffect(effect: FixEffect): void {
    fixEffect = effect;
  }

  function positionPopover(popover: HTMLElement, anchor: DOMRect): void {
    const width = Math.min(320, window.innerWidth - VIEWPORT_MARGIN * 2);
    popover.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, window.innerWidth - width - VIEWPORT_MARGIN))}px`;
    const height = popover.offsetHeight;
    const below = anchor.bottom + POPOVER_GAP;
    const above = anchor.top - POPOVER_GAP - height;
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
    // Open above the word rather than covering it when there is no room below.
    popover.style.top = !fitsBelow && above >= VIEWPORT_MARGIN
      ? `${above}px`
      : `${Math.max(VIEWPORT_MARGIN, Math.min(below, window.innerHeight - VIEWPORT_MARGIN - height))}px`;
  }

  function renderIssues(adapter: EditorAdapter, issues: readonly WritingIssue[]): void {
    currentAdapter = adapter;
    removeElements(issueElements);
    issueElements = [];
    markTargets = [];
    firstIssue = null;
    const hasSpelling = issues.some((issue) => issue.category === 'spelling');
    const hasGrammar = issues.some((issue) => issue.category !== 'spelling' && issue.category !== 'style');
    issueKinds = hasSpelling && hasGrammar ? 'both' : hasGrammar ? 'grammar' : 'spelling';
    const pinnedIssueId = popoverPinned ? popoverIssueId : null;
    let pinnedIssueFound = false;
    // Scrolled text boxes (chat inputs) keep text outside their visible area; never draw marks there.
    const bounds = adapter.element.getBoundingClientRect();
    const visible = (rect: DOMRect): boolean =>
      bounds.width === 0 || bounds.height === 0 || (
        rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1 &&
        rect.right > bounds.left && rect.left < bounds.right
      );
    for (const issue of issues) {
      if (issue.id === pinnedIssueId) pinnedIssueFound = true;
      const rects = adapter.rangeToRects(issue.range);
      let pinnedRect: DOMRect | undefined;
      for (const rect of rects) {
        if (rect.width === 0 || rect.height === 0 || !visible(rect)) continue;
        if (issue.id === pinnedIssueId && pinnedRect === undefined) pinnedRect = rect;
        if (firstIssue === null) firstIssue = Object.freeze({ issue, rect });
        const mark = button('', `mark ${issue.category}`, 'issue-mark');
        mark.dataset.issueId = issue.id;
        if (issue.id === pinnedIssueId) mark.classList.add('underline-hidden');
        mark.setAttribute('aria-label', issue.message);
        mark.style.left = `${rect.left - GRAMMAR_MARK_INLINE_PADDING}px`;
        mark.style.top = `${rect.top - GRAMMAR_MARK_BLOCK_PADDING}px`;
        mark.style.width = `${Math.max(3, rect.width) + GRAMMAR_MARK_INLINE_PADDING * 2}px`;
        mark.style.height = `${rect.height + GRAMMAR_MARK_BLOCK_PADDING * 3}px`;
        mark.style.setProperty('--mark-inline-inset', `${GRAMMAR_MARK_INLINE_PADDING}px`);
        mark.style.setProperty('--underline-top', `${rect.height + GRAMMAR_MARK_BLOCK_PADDING + 3}px`);
        mark.addEventListener('click', () => showPopover(issue, rect, true));
        layer.append(mark);
        issueElements.push(mark);
        markTargets.push(Object.freeze({ issue, rect, box: new DOMRect(
          rect.left - GRAMMAR_MARK_INLINE_PADDING,
          rect.top - GRAMMAR_MARK_BLOCK_PADDING,
          Math.max(3, rect.width) + GRAMMAR_MARK_INLINE_PADDING * 2,
          rect.height + GRAMMAR_MARK_BLOCK_PADDING * 3,
        ) }));
      }
      if (issue.id === pinnedIssueId && popoverElement !== null) {
        if (pinnedRect !== undefined) positionPopover(popoverElement, pinnedRect);
      }
    }
    if (pinnedIssueId !== null && !pinnedIssueFound) closePopover();
  }

  // The underlines take no pointer events, so hovering is worked out from their boxes.
  function onPointerMove(event: PointerEvent): void {
    // The card opens right under the word, so the word's box can overlap the card's top. While the pointer is on
    // the card, the card's own enter/leave handling decides; leaving the word's box there must not close it.
    const card = popoverElement?.getBoundingClientRect();
    if (card !== undefined && event.clientX >= card.left && event.clientX <= card.right &&
      event.clientY >= card.top && event.clientY <= card.bottom) {
      hoveredIssueId = null;
      cancelHoverClose();
      return;
    }
    const target = markTargets.find(({ box }) => (
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
    ));
    const issueId = target?.issue.id ?? null;
    if (issueId === hoveredIssueId) return;
    hoveredIssueId = issueId;
    if (target === undefined) {
      scheduleHoverClose();
      return;
    }
    cancelHoverClose();
    hoverTimer = window.setTimeout(() => showPopover(target.issue, target.rect), HOVER_OPEN_DELAY_MS);
  }
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });

  function followCaret(offset: number | null): void {
    const target = offset === null
      ? undefined
      : markTargets.find(({ issue }) => offset >= issue.range.start && offset <= issue.range.end);
    if (target === undefined) {
      if (popoverPinned) closePopover();
      return;
    }
    cancelHoverClose();
    showPopover(target.issue, target.rect, true);
  }

  function applyOption(index: number): boolean {
    const option = optionButtons[index];
    if (option === undefined) return false;
    option.click();
    return true;
  }

  function setApplyShortcut(label: string | null): void {
    shortcutLabel = label;
  }

  function clear(): void {
    removeElements(issueElements);
    issueElements = [];
    markTargets = [];
    hoveredIssueId = null;
    firstIssue = null;
    closePopover();
  }

  // Whole pixels keep the count sharp. A one-line field gets a smaller badge, tucked into its bottom-right corner.
  function placeBadge(badge: HTMLElement, editorRect: DOMRect): void {
    const compact = editorRect.height < COMPACT_FIELD_HEIGHT;
    badge.toggleAttribute('data-compact', compact);
    const size = compact ? COMPACT_BADGE_SIZE : BADGE_SIZE;
    const inset = compact ? COMPACT_BADGE_INSET : BADGE_INSET;
    badge.style.left = `${Math.round(editorRect.right - size - inset)}px`;
    badge.style.top = `${Math.round(editorRect.bottom - size - inset)}px`;
  }

  function showBadge(editorRect: DOMRect, state: BadgeState, count: number): void {
    if (badgeElement === null) {
      const badge = button('', 'badge', 'status-badge');
      // Keep focus (and the caret) in the editor when the badge is clicked.
      badge.addEventListener('pointerdown', (event) => event.preventDefault());
      badge.addEventListener('click', () => {
        if (badge.dataset.state === 'issues' && firstIssue !== null) {
          showPopover(firstIssue.issue, firstIssue.rect, true);
        }
      });
      layer.append(badge);
      badgeElement = badge;
    }
    const label = state === 'checking'
      ? 'checking…'
      : state === 'clear'
        ? 'no issues'
        : `${count} ${count === 1 ? 'suggestion' : 'suggestions'}`;
    badgeElement.dataset.state = state;
    if (state === 'issues') badgeElement.dataset.kinds = issueKinds;
    else delete badgeElement.dataset.kinds;
    // Mirrored on the host, outside the closed shadow root, so browser tests can read the state.
    host.dataset.state = state;
    host.dataset.issues = String(state === 'issues' ? count : 0);
    badgeElement.textContent = state === 'issues' ? (count > 9 ? '9+' : String(count)) : '';
    if (state === 'clear') badgeElement.append(icon('check'));
    badgeElement.setAttribute('aria-label', `Wordwarden: ${label}`);
    badgeElement.title = `Wordwarden: ${label}`;
    placeBadge(badgeElement, editorRect);
  }

  function moveBadge(editorRect: DOMRect): void {
    if (badgeElement !== null) placeBadge(badgeElement, editorRect);
  }

  function hideBadge(): void {
    badgeElement?.remove();
    badgeElement = null;
  }

  function showStatus(message: string): void {
    if (statusElement === null) {
      statusElement = document.createElement('div');
      statusElement.className = 'status';
      statusElement.dataset.testid = 'status';
      layer.append(statusElement);
    }
    statusElement.textContent = message;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(hideStatus, STATUS_SHOW_MS);
  }

  function hideStatus(): void {
    window.clearTimeout(statusTimer);
    statusElement?.remove();
    statusElement = null;
  }


  // Custom underlines are set on the host itself, so they win over both colour schemes.
  function setColorVision(vision: ColorVision, custom: CustomUnderlines): void {
    if (vision === 'standard') delete host.dataset.vision;
    else host.dataset.vision = vision;
    for (const kind of UNDERLINE_KINDS) {
      const mark = custom[kind];
      if (vision === 'custom') {
        host.style.setProperty(`--${kind}`, mark.color);
        host.style.setProperty(`--${kind}-line`, mark.line);
        // A double line needs 3px to show both strokes.
        host.style.setProperty(`--${kind}-width`, `${mark.line === 'double' ? Math.max(3, mark.thickness) : mark.thickness}px`);
      } else {
        for (const suffix of ['', '-line', '-width']) host.style.removeProperty(`--${kind}${suffix}`);
      }
    }
    if (vision === 'custom') {
      host.style.setProperty('--grammar-ink', custom.grammar.color);
      host.style.setProperty('--fix', custom.fix.color);
      host.style.setProperty('--fix-stroke', String(custom.fix.thickness * 0.75));
    } else {
      for (const property of ['--grammar-ink', '--fix', '--fix-stroke']) host.style.removeProperty(property);
    }
  }

  function destroy(): void {
    document.removeEventListener('pointermove', onPointerMove, { capture: true });
    clear();
    hideStatus();
    badgeElement = null;
    host.remove();
  }

  return Object.freeze({
    renderIssues,
    showBadge,
    moveBadge,
    hideBadge,
    closeIssuePopover,
    followCaret,
    applyOption,
    setApplyShortcut,
    clear,
    showStatus,
    hideStatus,
    setColorVision,
    setFixEffect,
    destroy,
  });
}
