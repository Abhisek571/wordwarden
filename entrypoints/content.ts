import { browser } from 'wxt/browser';
import {
  PAGE_STATUS_REQUEST,
  isRuntimeResponse,
  type RuntimeRequest,
  type RuntimeResponse,
} from '#/core/messages';
import type { PageStatus } from '#/core/diagnostics';
import { createEditorEffectQueue } from '#/core/effect-queue';
import { issueMatchesText, rebaseIssuesAfterReplacement } from '#/core/issue-ranges';
import {
  MAX_DICTIONARY_WORD_LENGTH, MAX_SETTINGS_LIST_LENGTH, mergeSettings, parseSettings, type TypeCheckSettings,
} from '#/core/settings';
import type { EditorAdapter, EditorSnapshot, WritingIssue } from '#/core/types';
import { caretOffset, createEditorAdapter } from '#/editors/editor-adapter';
import { isCapitalsWord } from '#/core/popular-vocabulary';
import { createTypingMeter, typedCharacterCount } from '#/core/typing-stats';
import {
  closestSupportedEditor, editorFromEvent, rememberPasswordField, type SupportedEditor,
} from '#/editors/editor-detection';
import { updateSettings } from '#/ui/settings-update';
import { createTypeCheckOverlay, type TypeCheckOverlay } from '#/ui/overlay';

const LINT_DEBOUNCE_MS = 260;
// Browsers stop an idle extension background after about 30 seconds, and with it the checking engine.
const ENGINE_KEEP_ALIVE_MS = 20_000;
const TYPING_STATS_FLUSH_MS = 10_000;
// How often the field being checked is looked at for being removed, hidden, moved or resized.
const FIELD_WATCH_MS = 300;
// A mistake counts toward typing accuracy only inside the text typed since the last check, not older text.
const TYPED_MISTAKE_SLACK = 2;
// Text still being typed has no full stop yet; that is not a typing mistake.
const UNFINISHED_TEXT_RULES = new Set(['SentenceEndingPunctuation']);

function writingConfigurationKey(settings: TypeCheckSettings): string {
  return JSON.stringify([settings.dialect, [...settings.dictionary].sort(), settings.ignoreCapitals]);
}

const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

const SHORTCUT_LABELS = Object.freeze({ alt: 'Alt', 'alt-shift': 'Alt+Shift', off: null });

// On macOS, Option with a digit types a character (¡ ™ £, or # and @ on other layouts), so it cannot be a shortcut.
function isMac(): boolean {
  return /^Mac/u.test(navigator.platform);
}

function shortcutLabel(shortcut: TypeCheckSettings['applyShortcut']): string | null {
  return isMac() ? null : SHORTCUT_LABELS[shortcut];
}

function matchesApplyShortcut(event: KeyboardEvent, shortcut: TypeCheckSettings['applyShortcut']): boolean {
  // AltGr reports Ctrl+Alt on Windows, so a held Ctrl never counts.
  if (shortcut === 'off' || isMac() || !event.altKey || event.ctrlKey || event.metaKey) return false;
  return event.shiftKey === (shortcut === 'alt-shift');
}

async function sendRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  const response: unknown = await browser.runtime.sendMessage(request);
  if (!isRuntimeResponse(response)) throw new TypeError('Runtime returned an invalid response.');
  return response;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Kept for the diagnostic log (the background strips quoted text). Reporting must never cause a new error.
function reportError(message: string): void {
  void sendRequest(Object.freeze({ type: 'error:report', message: message.slice(0, 1000) })).catch(() => undefined);
}

function editorKind(element: HTMLElement | undefined): PageStatus['editor'] {
  if (element === undefined) return 'none';
  if (element instanceof HTMLTextAreaElement) return 'textarea';
  return element instanceof HTMLInputElement ? 'input' : 'rich text';
}

export async function startTypeCheck(context: Readonly<{
  abort: () => void;
  onInvalidated: (callback: () => void) => void;
}>, options: Readonly<{ alwaysEnabled?: boolean }> = {}): Promise<void> {
    const response = await sendRequest(Object.freeze({ type: 'settings:get' }));
    if (!response.ok || !('settings' in response)) {
      throw new Error(response.ok ? 'Settings response is missing data.' : response.error);
    }
    let settings = response.settings;
    let ignoredIssueHashes = new Set(settings.ignoredIssueHashes);
    const isAvailable = (): boolean =>
      options.alwaysEnabled === true ||
      (settings.enabled && !settings.disabledSites.includes(location.hostname));

    let activeAdapter: EditorAdapter | null = null;
    let revision = 0;
    // Applying a fix in a rich editor waits briefly; a second click meanwhile is ignored.
    let applying = false;
    let currentIssues: readonly WritingIssue[] = Object.freeze([]);
    let checkerState: PageStatus['checker'] = 'not started';
    let lastCheckMs: number | null = null;
    // Answers the diagnostic log's question about this tab, even when the site is turned off.
    const onStatusRequest = (message: unknown): Promise<PageStatus> | undefined => {
      if ((message as { type?: unknown } | null)?.type !== PAGE_STATUS_REQUEST) return undefined;
      return Promise.resolve(Object.freeze({
        hostname: location.hostname,
        editor: editorKind(activeAdapter?.element),
        checker: checkerState,
        lastCheckMs,
        underlines: currentIssues.length,
      }));
    };
    browser.runtime.onMessage.addListener(onStatusRequest);
    context.onInvalidated(() => browser.runtime.onMessage.removeListener(onStatusRequest));
    // A page opened while Wordwarden or its site is off still listens, so switching back on works without a reload;
    // every handler checks isAvailable first.

    const effects = createEditorEffectQueue();
    let keepAliveTimer: number | null = null;
    let activeWritingConfiguration = writingConfigurationKey(settings);
    let writingConfigurationRevision = 0;
    let engineQueue: Promise<void> = Promise.resolve();
    let repositionFrame: number | null = null;
    let invalidated = false;
    const typingMeter = createTypingMeter();
    let sentTyping = typingMeter.read();
    let unsentMistakes = 0;
    /** Start of the text typed since the last check, or null when nothing was typed. */
    let typedFrom: number | null = null;
    let typingStatsTimer: number | null = null;
    const countedMistakes = new WeakMap<HTMLElement, Set<string>>();

    function flushTypingStats(): void {
      if (typingStatsTimer !== null) window.clearTimeout(typingStatsTimer);
      typingStatsTimer = null;
      const total = typingMeter.read();
      const delta = Object.freeze({
        characters: total.characters - sentTyping.characters,
        typingMs: Math.round(total.typingMs - sentTyping.typingMs),
        mistakes: unsentMistakes,
      });
      if (delta.characters === 0 && delta.mistakes === 0) return;
      sentTyping = total;
      unsentMistakes = 0;
      void sendRequest(Object.freeze({ type: 'typing-stats:add', delta })).catch(() => undefined);
    }

    function scheduleTypingStats(): void {
      typingStatsTimer ??= window.setTimeout(flushTypingStats, TYPING_STATS_FLUSH_MS);
    }

    function countTypedMistakes(adapter: EditorAdapter, issues: readonly WritingIssue[], from: number): void {
      const caret = caretOffset(adapter.element);
      if (caret === null) return;
      let counted = countedMistakes.get(adapter.element);
      if (counted === undefined) countedMistakes.set(adapter.element, counted = new Set());
      for (const issue of issues) {
        // The checker's ids follow the surrounding sentence, which changes with every word typed.
        const key = `${issue.ruleId}:${issue.range.start}:${issue.originalText}`;
        if (issue.category === 'style' || UNFINISHED_TEXT_RULES.has(issue.ruleId) || counted.has(key)) continue;
        // A word the cursor is still in may just be half typed.
        if (issue.range.end >= caret || issue.range.end < from - TYPED_MISTAKE_SLACK) continue;
        counted.add(key);
        unsentMistakes += 1;
      }
      if (unsentMistakes > 0) scheduleTypingStats();
    }

    let checkWhenVisible = false;
    function onPageHidden(): void {
      if (document.visibilityState !== 'hidden') {
        if (checkWhenVisible && activeAdapter !== null) scheduleAnalysis(activeAdapter);
        checkWhenVisible = false;
        return;
      }
      flushTypingStats();
      stopKeepingEngineAlive();
    }

    function enqueueEngineOperation<T>(operation: () => Promise<T>): Promise<T> {
      const result = engineQueue.then(operation, operation);
      engineQueue = result.then(() => undefined, () => undefined);
      return result;
    }

    const overlay: TypeCheckOverlay = createTypeCheckOverlay(
      Object.freeze({
        apply: (issue: WritingIssue, replacement: string): void => {
          if (activeAdapter === null) return;
          // The field was removed or re-rendered (a chat box, a page change); its marks are stale.
          if (!activeAdapter.element.isConnected) {
            currentIssues = Object.freeze([]);
            overlay.clear();
            return;
          }
          const currentText = activeAdapter.capture(revision).text;
          if (!issueMatchesText(issue, currentText)) {
            overlay.clear();
            scheduleAnalysis(activeAdapter);
            overlay.showStatus('The text changed. Check again before applying this suggestion.');
            return;
          }
          const remainingIssues = rebaseIssuesAfterReplacement(
            currentIssues,
            issue,
            replacement,
          );
          if (applying) return;
          applying = true;
          const adapter = activeAdapter;
          void adapter.applySuggestion(issue.range, replacement, revision).then((result) => {
            applying = false;
            if (activeAdapter !== adapter) return;
            if (!result.applied) {
              overlay.showStatus('Could not apply this suggestion safely.');
              scheduleAnalysis(adapter);
              return;
            }
            revision = result.revision;
            scheduleAnalysis(adapter);
            currentIssues = remainingIssues;
            overlay.renderIssues(adapter, currentIssues);
          }, (error: unknown) => {
            applying = false;
            reportError(`Could not apply suggestion: ${errorText(error)}`);
            overlay.showStatus('Could not apply this suggestion safely.');
          });
        },
        ignoreAlways: (issue: WritingIssue): void => {
          const hashes = new Set(ignoredIssueHashes);
          if (hashes.size >= MAX_SETTINGS_LIST_LENGTH) {
            overlay.showStatus('The ignore list is full. Reset ignored suggestions in Settings to add more.');
            return;
          }
          hashes.add(issue.issueHash);
          const next = mergeSettings(settings, { ignoredIssueHashes: [...hashes] });
          void persistSettings(next)
            .then(() => {
              currentIssues = currentIssues.filter(
                (candidate) => candidate.issueHash !== issue.issueHash,
              );
              if (activeAdapter !== null) overlay.renderIssues(activeAdapter, currentIssues);
            })
            .catch((error: unknown) => {
              reportError(`Could not ignore issue: ${errorText(error)}`);
              overlay.showStatus(`Could not ignore issue: ${errorText(error)}`);
            });
        },
        addWord: (issue: WritingIssue): void => {
          if (activeAdapter === null) return;
          const snapshot = activeAdapter.capture(revision);
          const word = snapshot.text.slice(issue.range.start, issue.range.end).trim();
          if (word.length === 0) return;
          if (word.length > MAX_DICTIONARY_WORD_LENGTH) {
            overlay.showStatus(`A dictionary word can be at most ${MAX_DICTIONARY_WORD_LENGTH} characters long.`);
            return;
          }
          const words = new Set(settings.dictionary);
          if (!words.has(word) && words.size >= MAX_SETTINGS_LIST_LENGTH) {
            overlay.showStatus('The dictionary is full. Remove some words in Settings to add more.');
            return;
          }
          words.add(word);
          const next = mergeSettings(settings, { dictionary: [...words].sort() });
          void persistSettings(next).catch((error: unknown) => {
            reportError(`Could not add word: ${errorText(error)}`);
            overlay.showStatus(`Could not add word: ${errorText(error)}`);
          });
        },
      }),
    );
    overlay.setColorVision(settings.colorVision, settings.customUnderlines);
    overlay.setApplyShortcut(shortcutLabel(settings.applyShortcut));
    overlay.setFixEffect(settings.fixEffect);

    function visibleIssues(issues: readonly WritingIssue[]): readonly WritingIssue[] {
      return Object.freeze(issues.filter((issue) => (
        !ignoredIssueHashes.has(issue.issueHash) &&
        !(settings.ignoreCapitals && issue.category === 'spelling' && isCapitalsWord(issue.originalText))
      )));
    }

    // The background rebuilds its engine for the new settings on the next check; this tab only checks again.
    function queueWritingEngineReset(targetRevision: number): Promise<void> {
      effects.cancel();
      return enqueueEngineOperation(async () => {
        if (
          !invalidated &&
          targetRevision === writingConfigurationRevision &&
          activeAdapter !== null &&
          isAvailable()
        ) {
          scheduleAnalysis(activeAdapter);
        }
      });
    }

    function applySettings(next: TypeCheckSettings): Promise<void> {
      settings = next;
      overlay.setColorVision(next.colorVision, next.customUnderlines);
      overlay.setApplyShortcut(shortcutLabel(next.applyShortcut));
      overlay.setFixEffect(next.fixEffect);
      ignoredIssueHashes = new Set(next.ignoredIssueHashes);
      const nextConfiguration = writingConfigurationKey(next);
      if (nextConfiguration === activeWritingConfiguration) return Promise.resolve();
      activeWritingConfiguration = nextConfiguration;
      writingConfigurationRevision += 1;
      currentIssues = Object.freeze([]);
      overlay.clear();
      return queueWritingEngineReset(writingConfigurationRevision);
    }

    async function persistSettings(next: TypeCheckSettings): Promise<void> {
      const saved = await updateSettings(settings, next);
      await applySettings(saved);
    }

    // A background that the browser stopped mid-check drops the answer; asking once more starts it again.
    async function requestLint(text: string): Promise<RuntimeResponse> {
      try {
        return await sendRequest(Object.freeze({ type: 'engine:lint', text }));
      } catch (error) {
        if (!/message channel closed|Receiving end does not exist|Could not establish connection/iu.test(errorText(error))) {
          throw error;
        }
        return sendRequest(Object.freeze({ type: 'engine:lint', text }));
      }
    }

    async function lintText(text: string): Promise<readonly WritingIssue[]> {
      if (checkerState !== 'ready') checkerState = 'starting';
      try {
        const answer = await requestLint(text);
        if (!answer.ok) throw new Error(answer.error);
        if (!('issues' in answer)) throw new Error('Checker response is missing data.');
        checkerState = 'ready';
        return answer.issues;
      } catch (error) {
        checkerState = 'failed';
        throw error;
      }
    }

    // After an update or reload of the extension this script is cut off from it; it then removes what it drew.
    function isCutOff(): boolean {
      return (browser.runtime as { id?: string } | undefined)?.id === undefined;
    }

    function keepEngineAlive(): void {
      if (keepAliveTimer !== null) return;
      // The first ping also starts the engine, so the first check after an idle spell is not slow.
      void sendRequest(Object.freeze({ type: 'engine:keep-alive' })).catch(() => undefined);
      keepAliveTimer = window.setInterval(() => {
        if (isCutOff()) {
          teardown();
          return;
        }
        void sendRequest(Object.freeze({ type: 'engine:keep-alive' })).catch(() => undefined);
      }, ENGINE_KEEP_ALIVE_MS);
    }

    function stopKeepingEngineAlive(): void {
      if (keepAliveTimer !== null) window.clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }

    async function analyze(adapter: EditorAdapter, snapshot: EditorSnapshot): Promise<void> {
      const sourceRevision = snapshot.revision;
      const sourceConfigurationRevision = writingConfigurationRevision;
      await enqueueEngineOperation(async () => {
        const isStale = (): boolean =>
          invalidated ||
          revision !== sourceRevision ||
          writingConfigurationRevision !== sourceConfigurationRevision ||
          activeAdapter?.id !== adapter.id;
        if (isStale()) return;
        if (snapshot.text.trim().length === 0) {
          currentIssues = Object.freeze([]);
          overlay.clear();
          overlay.showBadge(adapter.element.getBoundingClientRect(), 'clear', 0);
          return;
        }
        lastCheckedText = snapshot.text;
        try {
          const started = performance.now();
          const issues = await lintText(snapshot.text);
          lastCheckMs = Math.round(performance.now() - started);
          if (isStale()) return;
          currentIssues = visibleIssues(issues);
          overlay.renderIssues(adapter, currentIssues);
          if (typedFrom !== null && settings.typingStats) countTypedMistakes(adapter, currentIssues, typedFrom);
          typedFrom = null;
          overlay.showBadge(
            adapter.element.getBoundingClientRect(),
            currentIssues.length === 0 ? 'clear' : 'issues',
            currentIssues.length,
          );
        } catch (error) {
          if (isStale()) return;
          overlay.hideBadge();
          reportError(`Grammar checker failed: ${errorText(error)}`);
          overlay.showStatus(`Grammar checker failed: ${errorText(error)}`);
        }
      });
    }

    function scheduleAnalysis(adapter: EditorAdapter): void {
      if (invalidated || !isAvailable()) return;
      effects.cancel();
      currentIssues = Object.freeze([]);
      overlay.showBadge(adapter.element.getBoundingClientRect(), 'checking', 0);
      // The text is read once typing pauses, not on every key: in a rich editor reading it walks the whole field.
      effects.schedule(LINT_DEBOUNCE_MS, () => void analyze(adapter, adapter.capture(revision)));
    }

    function activate(event: Event): void {
      const editor = editorFromEvent(event);
      if (editor !== null) activateEditor(editor);
    }

    function activateEditor(editor: SupportedEditor): void {
      if (!isAvailable()) return;
      if (activeAdapter?.element !== editor) {
        activeAdapter = createEditorAdapter(editor);
        revision = 0;
        typedFrom = null;
        currentIssues = Object.freeze([]);
        overlay.clear();
        watchEditorText(editor);
      }
      keepEngineAlive();
      watchField();
      scheduleAnalysis(activeAdapter);
    }

    // Drops everything drawn for a field that was removed or hidden (a chat box re-rendered, a page change), and
    // redraws when the field moves or changes size without a scroll (an image loading above it, a resize handle).
    let fieldTimer: number | null = null;
    let fieldBox = '';
    function watchField(): void {
      if (fieldTimer !== null) return;
      fieldTimer = window.setInterval(() => {
        if (isCutOff()) {
          teardown();
          return;
        }
        const element = activeAdapter?.element;
        if (element === undefined) return;
        if (!element.isConnected || element.getClientRects().length === 0) {
          forgetField();
          return;
        }
        const box = element.getBoundingClientRect();
        const key = `${box.left},${box.top},${box.width},${box.height}`;
        if (key !== fieldBox) {
          fieldBox = key;
          reposition();
        }
      }, FIELD_WATCH_MS);
    }

    function forgetField(): void {
      effects.cancel();
      currentIssues = Object.freeze([]);
      overlay.clear();
      overlay.hideBadge();
      activeAdapter = null;
      textObserver?.disconnect();
      stopKeepingEngineAlive();
      if (fieldTimer !== null) window.clearInterval(fieldTimer);
      fieldTimer = null;
    }

    // Rich editors can change their text without an input event: undo in some editors, a page's own autocorrect,
    // editors that use EditContext. Their DOM changes are watched, and the text is checked again when it really
    // changed (syntax highlighting rewrites the DOM but not the text).
    let textObserver: MutationObserver | null = null;
    let mutationTimer: number | null = null;
    let lastInputAt = 0;
    let lastCheckedText: string | null = null;
    function watchEditorText(editor: SupportedEditor): void {
      textObserver?.disconnect();
      textObserver = null;
      lastCheckedText = null;
      if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) return;
      textObserver = new MutationObserver(() => {
        if (mutationTimer !== null) window.clearTimeout(mutationTimer);
        mutationTimer = window.setTimeout(() => {
          mutationTimer = null;
          const adapter = activeAdapter;
          if (adapter === null || adapter.element !== editor || applying || invalidated) return;
          // Typing already starts a check.
          if (performance.now() - lastInputAt < LINT_DEBOUNCE_MS * 2) return;
          const text = adapter.capture(revision).text;
          if (lastCheckedText === null || text === lastCheckedText) return;
          revision += 1;
          overlay.clear();
          scheduleAnalysis(adapter);
        }, LINT_DEBOUNCE_MS);
      });
      textObserver.observe(editor, { characterData: true, childList: true, subtree: true });
    }

    function onInput(event: Event): void {
      if (!isAvailable()) return;
      const editor = editorFromEvent(event);
      if (editor === null) return;
      lastInputAt = performance.now();
      if (activeAdapter?.element !== editor) {
        activeAdapter = createEditorAdapter(editor);
        typedFrom = null;
        watchEditorText(editor);
        watchField();
      }
      const typed = settings.typingStats ? typedCharacterCount(event) : 0;
      if (typed > 0) {
        typingMeter.type(performance.now(), typed);
        const caret = caretOffset(editor);
        if (caret !== null) typedFrom = Math.max(0, Math.min(typedFrom ?? caret, caret - typed));
        scheduleTypingStats();
      }
      revision += 1;
      overlay.clear();
      // A script typing into a field of a hidden tab must not hold up checks in the tab being used.
      if (document.visibilityState === 'hidden') {
        checkWhenVisible = true;
        return;
      }
      scheduleAnalysis(activeAdapter);
    }

    function deactivate(event: FocusEvent): void {
      if (activeAdapter === null || editorFromEvent(event) !== activeAdapter.element) return;
      // Focus moving into the suggestion card or badge keeps the badge visible.
      const next = event.relatedTarget;
      if (next instanceof Element && next.id === 'typecheck-root') return;
      stopKeepingEngineAlive();
      overlay.hideBadge();
    }

    // Keys typed in another field, a button or a password box are not for the card, even while it is open.
    function isForActiveEditor(event: KeyboardEvent): boolean {
      if (activeAdapter === null) return false;
      return editorFromEvent(event) === activeAdapter.element ||
        event.composedPath().some((node) => node instanceof Element && node.id === 'typecheck-root');
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (!isAvailable()) return;
      if (event.key === 'Escape') {
        const issueClosed = overlay.closeIssuePopover();
        if (issueClosed) event.preventDefault();
        return;
      }
      // Digit codes keep the shortcut on the same keys in every keyboard layout.
      const option = /^Digit([1-3])$/u.exec(event.code)?.[1];
      if (option !== undefined && matchesApplyShortcut(event, settings.applyShortcut) &&
          isForActiveEditor(event) && overlay.applyOption(Number(option) - 1)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    // Clicking into a marked word, or moving onto it with the arrow keys, opens its card.
    function followCaret(event: Event): void {
      if (activeAdapter === null || editorFromEvent(event) !== activeAdapter.element) return;
      if (event instanceof KeyboardEvent && !CARET_KEYS.has(event.key)) return;
      overlay.followCaret(caretOffset(activeAdapter.element));
    }

    // A click inside a selection moves the caret only after the mouse is released, so read it a moment later.
    function followClick(event: Event): void {
      window.setTimeout(() => {
        if (!invalidated) followCaret(event);
      }, 0);
    }

    // A pinned card closes when the writer clicks anywhere outside the field and the card.
    function closeOnOutsideClick(event: PointerEvent): void {
      const path = event.composedPath();
      if (path.some((node) => node instanceof Element && node.id === 'typecheck-root')) return;
      if (activeAdapter !== null && path.includes(activeAdapter.element)) return;
      overlay.closeIssuePopover();
    }

    // Remembers fields that were password fields, so a "show password" button does not expose them.
    function rememberPasswords(event: Event): void {
      const target = event.composedPath()[0];
      if (target instanceof HTMLInputElement && target.type === 'password') rememberPasswordField(target);
    }

    function reposition(): void {
      if (activeAdapter === null || repositionFrame !== null || invalidated) return;
      repositionFrame = window.requestAnimationFrame(() => {
        repositionFrame = null;
        if (activeAdapter !== null && !invalidated) {
          overlay.renderIssues(activeAdapter, currentIssues);
          overlay.moveBadge(activeAdapter.element.getBoundingClientRect());
        }
      });
    }

    for (const field of document.querySelectorAll<HTMLInputElement>('input[type="password"]')) rememberPasswordField(field);
    document.addEventListener('focusin', rememberPasswords, true);
    document.addEventListener('focusin', activate, true);
    document.addEventListener('focusout', deactivate, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', followCaret, true);
    document.addEventListener('pointerup', followClick, true);
    document.addEventListener('pointerdown', closeOnOutsideClick, true);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('visibilitychange', onPageHidden);
    // A field that had focus before these listeners existed (a slow start, or a page that focuses a field as it
    // loads) gets no focus event; check it now.
    const focused = document.activeElement === null ? null : closestSupportedEditor(document.activeElement);
    if (focused !== null) activateEditor(focused);

    const onStorageChanged: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
      changes,
      areaName,
    ) => {
      if (areaName !== 'local') return;
      const change = changes['typecheck.settings.v1'];
      if (change === undefined) return;
      const nextSettings = parseSettings(change.newValue);
      const wasAvailable = isAvailable();
      settings = nextSettings;
      if (!isAvailable()) {
        forgetField();
        return;
      }
      void applySettings(nextSettings).catch((error: unknown) => {
        overlay.showStatus(
          `Could not reload writing checker: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      // Switched back on: check the field the writer is in straight away.
      const current = document.activeElement === null ? null : closestSupportedEditor(document.activeElement);
      if (!wasAvailable && current !== null) activateEditor(current);
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    function teardown(): void {
      if (invalidated) return;
      invalidated = true;
      effects.dispose();
      if (repositionFrame !== null) window.cancelAnimationFrame(repositionFrame);
      repositionFrame = null;
      if (fieldTimer !== null) window.clearInterval(fieldTimer);
      fieldTimer = null;
      if (mutationTimer !== null) window.clearTimeout(mutationTimer);
      textObserver?.disconnect();
      document.removeEventListener('focusin', rememberPasswords, true);
      document.removeEventListener('focusin', activate, true);
      document.removeEventListener('focusout', deactivate, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', followCaret, true);
      document.removeEventListener('pointerup', followClick, true);
      document.removeEventListener('pointerdown', closeOnOutsideClick, true);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('visibilitychange', onPageHidden);
      if (!isCutOff()) {
        browser.storage.onChanged.removeListener(onStorageChanged);
        flushTypingStats();
      }
      stopKeepingEngineAlive();
      overlay.destroy();
    }
    context.onInvalidated(teardown);
}

type ContentContext = Parameters<typeof startTypeCheck>[0];

// Fields inside frames (comment boxes, embedded editors) are checked too. A frame starts checking only when one of its
// fields gets focus, so the many frames that hold no field (adverts, videos) never wake the background.
async function startInFrame(context: ContentContext): Promise<void> {
  if (window === window.top) return startTypeCheck(context);
  const focused = document.activeElement === null ? null : closestSupportedEditor(document.activeElement);
  if (focused === null) {
    await new Promise<void>((resolve) => {
      const onFocus = (event: Event): void => {
        if (editorFromEvent(event) === null) return;
        document.removeEventListener('focusin', onFocus, true);
        resolve();
      };
      document.addEventListener('focusin', onFocus, true);
      context.onInvalidated(() => document.removeEventListener('focusin', onFocus, true));
    });
  }
  return startTypeCheck(context);
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: 'document_idle',
  main: startInFrame,
});
