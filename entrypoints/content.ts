import { browser } from 'wxt/browser';
import {
  isRuntimeResponse,
  type RuntimeRequest,
  type RuntimeResponse,
} from '#/core/messages';
import { createEditorEffectQueue } from '#/core/effect-queue';
import { issueMatchesText, rebaseIssuesAfterReplacement } from '#/core/issue-ranges';
import { mergeSettings, parseSettings, type TypeCheckSettings } from '#/core/settings';
import type { EditorAdapter, EditorSnapshot, WritingIssue } from '#/core/types';
import { createHarperEngine, type HarperEngine } from '#/engines/harper-engine';
import { caretOffset, createEditorAdapter } from '#/editors/editor-adapter';
import { isCapitalsWord } from '#/core/popular-vocabulary';
import { createTypingMeter, typedCharacterCount } from '#/core/typing-stats';
import { editorFromEvent } from '#/editors/editor-detection';
import { updateSettings } from '#/ui/settings-update';
import { createTypeCheckOverlay, type TypeCheckOverlay } from '#/ui/overlay';

const LINT_DEBOUNCE_MS = 260;
const TYPING_STATS_FLUSH_MS = 10_000;
// A mistake counts toward typing accuracy only inside the text typed since the last check, not older text.
const TYPED_MISTAKE_SLACK = 2;
// Text still being typed has no full stop yet; that is not a typing mistake.
const UNFINISHED_TEXT_RULES = new Set(['SentenceEndingPunctuation']);

function writingConfigurationKey(settings: TypeCheckSettings): string {
  return JSON.stringify([settings.dialect, [...settings.dictionary].sort(), settings.ignoreCapitals]);
}

const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

const SHORTCUT_LABELS = Object.freeze({ alt: 'Alt', 'alt-shift': 'Alt+Shift', off: null });

function matchesApplyShortcut(event: KeyboardEvent, shortcut: TypeCheckSettings['applyShortcut']): boolean {
  // AltGr reports Ctrl+Alt on Windows, so a held Ctrl never counts.
  if (shortcut === 'off' || !event.altKey || event.ctrlKey || event.metaKey) return false;
  return event.shiftKey === (shortcut === 'alt-shift');
}

async function sendRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  const response: unknown = await browser.runtime.sendMessage(request);
  if (!isRuntimeResponse(response)) throw new TypeError('Runtime returned an invalid response.');
  return response;
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
    if (!isAvailable()) return;

    let activeAdapter: EditorAdapter | null = null;
    let revision = 0;
    let currentIssues: readonly WritingIssue[] = Object.freeze([]);
    const effects = createEditorEffectQueue();
    let harper: HarperEngine | null = null;
    let harperReady: Promise<void> | null = null;
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

    function onPageHidden(): void {
      if (document.visibilityState === 'hidden') flushTypingStats();
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
          const result = activeAdapter.applySuggestion(issue.range, replacement, revision);
          if (!result.applied) {
            overlay.showStatus('Could not apply this suggestion safely.');
            return;
          }
          revision = result.revision;
          scheduleAnalysis(activeAdapter);
          currentIssues = remainingIssues;
          overlay.renderIssues(activeAdapter, currentIssues);
        },
        ignoreOnce: (issue: WritingIssue): void => {
          currentIssues = currentIssues.filter((candidate) => candidate.id !== issue.id);
          if (activeAdapter !== null) overlay.renderIssues(activeAdapter, currentIssues);
        },
        ignoreAlways: (issue: WritingIssue): void => {
          const hashes = new Set(ignoredIssueHashes);
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
              overlay.showStatus(
                `Could not ignore issue: ${error instanceof Error ? error.message : String(error)}`,
              );
            });
        },
        addWord: (issue: WritingIssue): void => {
          if (activeAdapter === null) return;
          const snapshot = activeAdapter.capture(revision);
          const word = snapshot.text.slice(issue.range.start, issue.range.end).trim();
          if (word.length === 0) return;
          const words = new Set(settings.dictionary);
          words.add(word);
          const next = mergeSettings(settings, { dictionary: [...words].sort() });
          void persistSettings(next).catch((error: unknown) => {
            overlay.showStatus(
              `Could not add word: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        },
      }),
    );
    overlay.setColorVision(settings.colorVision, settings.customUnderlines);
    overlay.setApplyShortcut(SHORTCUT_LABELS[settings.applyShortcut]);
    overlay.setFixEffect(settings.fixEffect);

    function visibleIssues(issues: readonly WritingIssue[]): readonly WritingIssue[] {
      return Object.freeze(issues.filter((issue) => (
        !ignoredIssueHashes.has(issue.issueHash) &&
        !(settings.ignoreCapitals && issue.category === 'spelling' && isCapitalsWord(issue.originalText))
      )));
    }

    function queueWritingEngineReset(targetRevision: number): Promise<void> {
      effects.cancel();
      const previousHarper = harper;
      const previousReady = harperReady;
      harper = null;
      harperReady = null;
      return enqueueEngineOperation(async () => {
        if (previousReady !== null) {
          try {
            await previousReady;
          } catch (error) {
            if (!invalidated) {
              overlay.showStatus(
                `Previous grammar checker stopped: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }
        if (previousHarper !== null) await previousHarper.dispose();
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
      overlay.setApplyShortcut(SHORTCUT_LABELS[next.applyShortcut]);
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

    async function ensureHarper(): Promise<HarperEngine> {
      if (harper === null) harper = createHarperEngine();
      const engine = harper;
      // The field badge shows "checking" while the engine starts.
      harperReady ??= engine.setup(settings.dialect, settings.dictionary);
      const ready = harperReady;
      await ready;
      return engine;
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
        try {
          const engine = await ensureHarper();
          const issues = await engine.lint(snapshot.text);
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
          overlay.showStatus(
            `Grammar checker failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    }

    function scheduleAnalysis(adapter: EditorAdapter): void {
      if (invalidated) return;
      effects.cancel();
      const snapshot = adapter.capture(revision);
      currentIssues = Object.freeze([]);
      overlay.showBadge(adapter.element.getBoundingClientRect(), 'checking', 0);
      effects.schedule(LINT_DEBOUNCE_MS, () => void analyze(adapter, snapshot));
    }

    function activate(event: Event): void {
      const editor = editorFromEvent(event);
      if (editor === null) return;
      if (activeAdapter?.element !== editor) {
        activeAdapter = createEditorAdapter(editor);
        revision = 0;
        typedFrom = null;
        currentIssues = Object.freeze([]);
        overlay.clear();
      }
      scheduleAnalysis(activeAdapter);
    }

    function onInput(event: Event): void {
      const editor = editorFromEvent(event);
      if (editor === null) return;
      if (activeAdapter?.element !== editor) {
        activeAdapter = createEditorAdapter(editor);
        typedFrom = null;
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
      scheduleAnalysis(activeAdapter);
    }

    function deactivate(event: FocusEvent): void {
      if (activeAdapter === null || editorFromEvent(event) !== activeAdapter.element) return;
      // Focus moving into the suggestion card or badge keeps the badge visible.
      const next = event.relatedTarget;
      if (next instanceof Element && next.id === 'typecheck-root') return;
      overlay.hideBadge();
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        const issueClosed = overlay.closeIssuePopover();
        if (issueClosed) event.preventDefault();
        return;
      }
      // Digit codes keep the shortcut on the same keys in every keyboard layout.
      const option = /^Digit([1-3])$/u.exec(event.code)?.[1];
      if (option !== undefined && matchesApplyShortcut(event, settings.applyShortcut) &&
          overlay.applyOption(Number(option) - 1)) {
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

    document.addEventListener('focusin', activate, true);
    document.addEventListener('focusout', deactivate, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', followCaret, true);
    document.addEventListener('pointerup', followCaret, true);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('visibilitychange', onPageHidden);

    const onStorageChanged: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
      changes,
      areaName,
    ) => {
      if (areaName !== 'local') return;
      const change = changes['typecheck.settings.v1'];
      if (change === undefined) return;
      const nextSettings = parseSettings(change.newValue);
      settings = nextSettings;
      if (!isAvailable()) {
        overlay.destroy();
        context.abort();
        return;
      }
      void applySettings(nextSettings).catch((error: unknown) => {
        overlay.showStatus(
          `Could not reload writing checker: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    context.onInvalidated(() => {
      invalidated = true;
      effects.dispose();
      if (repositionFrame !== null) window.cancelAnimationFrame(repositionFrame);
      repositionFrame = null;
      document.removeEventListener('focusin', activate, true);
      document.removeEventListener('focusout', deactivate, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', followCaret, true);
      document.removeEventListener('pointerup', followCaret, true);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('visibilitychange', onPageHidden);
      browser.storage.onChanged.removeListener(onStorageChanged);
      flushTypingStats();
      const previousHarper = harper;
      const previousReady = harperReady;
      harper = null;
      harperReady = null;
      void enqueueEngineOperation(async () => {
        if (previousReady !== null) {
          try {
            await previousReady;
          } catch {
            // Failed setup already disposes its partially initialized linter.
          }
        }
        await previousHarper?.dispose();
      }).catch((error: unknown) => {
        console.error('Wordwarden cleanup failed.', error);
      });
      overlay.destroy();
    });
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main: startTypeCheck,
});
