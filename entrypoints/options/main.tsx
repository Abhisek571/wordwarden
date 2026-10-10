import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import type { EnglishDialect } from '#/core/types';
import {
  DEFAULT_CUSTOM_UNDERLINES, MAX_UNDERLINE_THICKNESS, MIN_UNDERLINE_THICKNESS, UNDERLINE_KINDS,
  type ApplyShortcut, type ColorVision, type CustomUnderlines, type FixEffect, type TypeCheckSettings, type UnderlineLine, type UnderlineMark,
} from '#/core/settings';
import { isSafeHostname } from '#/core/diagnostics';
import { runtimeRequest } from '#/ui/runtime';
import { updateSettings } from '#/ui/settings-update';
import { exportDictionary, parseDictionaryImport, type DictionaryImportPreview } from '#/core/dictionary-transfer';
import { BrandMark, CloseIcon } from '#/ui/brand';
import '#/ui/app.css';

// Mandatory before publishing: set this to the repository's GitHub new-issue URL.
// See RELEASE_TODO.md. Leaving it null keeps the action safely unavailable.
const GITHUB_ISSUE_URL: string | null = null;

function Toggle(props: Readonly<{ enabled: boolean; label: string; onToggle: () => void; disabled?: boolean }>): React.JSX.Element {
  return (
    <button className={`toggle ${props.enabled ? 'on' : ''}`} type="button" role="switch"
      aria-checked={props.enabled} aria-label={props.label} onClick={props.onToggle} disabled={props.disabled} />
  );
}

const UNDERLINE_LABELS = Object.freeze({ spelling: 'Spelling', grammar: 'Grammar', style: 'Style', fix: 'Applied fix' });
// The fix mark is the short flash on a word after a suggestion is applied; it has a colour and thickness only.
const EDITOR_KINDS = Object.freeze([...UNDERLINE_KINDS, 'fix'] as const);
const CHANNELS = Object.freeze(['Red', 'Green', 'Blue'] as const);

function hexToRgb(hex: string): readonly number[] {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function rgbToHex(rgb: readonly number[]): string {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function clampChannel(value: string): number {
  const number = Number.parseInt(value, 10);
  return Number.isNaN(number) ? 0 : Math.min(255, Math.max(0, number));
}

/** Advanced editing: the writer's own colour, line and thickness for each kind of underline. */
function UnderlineEditor(props: Readonly<{
  value: CustomUnderlines;
  active: boolean;
  disabled: boolean;
  onApply: (value: CustomUnderlines) => void;
}>): React.JSX.Element {
  const saved = JSON.stringify(props.value);
  const [draft, setDraft] = useState(props.value);
  const [draftBase, setDraftBase] = useState(saved);
  // Reloaded settings arrive as new objects; only a real change to the saved values resets the draft.
  if (draftBase !== saved) {
    setDraftBase(saved);
    setDraft(props.value);
  }
  const changed = JSON.stringify(draft) !== saved;

  function update(kind: keyof CustomUnderlines, patch: Partial<UnderlineMark>): void {
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }));
  }

  return (
    <details className="card underline-editor" open={props.active}>
      <summary><h3>Advanced editing</h3><p className="muted">Set your own colour, line and thickness for each underline, and the colour of the fix animation.</p></summary>
      <div className="underline-rows">
        {EDITOR_KINDS.map((kind) => {
          const mark = draft[kind];
          const rgb = hexToRgb(mark.color);
          const sample = kind === 'fix' ? 'fixed word' : `${UNDERLINE_LABELS[kind].toLowerCase()} mistake`;
          return (
            <fieldset className="underline-row" key={kind} data-testid={`underline-${kind}`}>
              <legend>{UNDERLINE_LABELS[kind]}</legend>
              <span className="underline-sample" style={kind === 'fix' ? { color: mark.color } : {
                borderBottom: `${mark.line === 'double' ? Math.max(3, mark.thickness) : mark.thickness}px ${mark.line} ${mark.color}`,
              }}>{sample}</span>
              <label className="swatch">Colour
                <input type="color" value={mark.color} disabled={props.disabled}
                  onChange={(event) => update(kind, { color: event.target.value })} />
              </label>
              {CHANNELS.map((channel, index) => (
                <label key={channel}>{channel}
                  <input type="number" min={0} max={255} inputMode="numeric" value={rgb[index]} disabled={props.disabled}
                    data-testid={`underline-${kind}-${channel.toLowerCase()}`}
                    onChange={(event) => update(kind, {
                      color: rgbToHex(rgb.map((value, at) => (at === index ? clampChannel(event.target.value) : value))),
                    })} />
                </label>
              ))}
              {kind === 'fix' ? <span aria-hidden="true" /> : <label>Line
                <select value={mark.line} disabled={props.disabled}
                  onChange={(event) => update(kind, { line: event.target.value as UnderlineLine })}>
                  <option value="solid">Solid</option><option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option><option value="double">Double</option>
                </select>
              </label>}
              <label>Thickness
                <select value={mark.thickness} disabled={props.disabled}
                  onChange={(event) => update(kind, { thickness: Number(event.target.value) })}>
                  {Array.from({ length: MAX_UNDERLINE_THICKNESS - MIN_UNDERLINE_THICKNESS + 1 }, (_, offset) => MIN_UNDERLINE_THICKNESS + offset)
                    .map((size) => <option key={size} value={size}>{size} px</option>)}
                </select>
              </label>
            </fieldset>
          );
        })}
      </div>
      <p className="muted">Custom colours are used on both light and dark pages.</p>
      <div className="button-row">
        <button className="primary" type="button" data-testid="apply-underlines" disabled={props.disabled || (props.active && !changed)}
          onClick={() => props.onApply(draft)}>Use these colours</button>
        <button className="secondary" type="button" disabled={props.disabled}
          onClick={() => setDraft(DEFAULT_CUSTOM_UNDERLINES)}>Reset to standard</button>
      </div>
    </details>
  );
}

function sourceHostname(): string | null {
  const value = new URLSearchParams(window.location.search).get('site');
  return isSafeHostname(value) ? value.toLowerCase() : null;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) throw new Error('The diagnostic log could not be copied.');
  }
}

function Options(): React.JSX.Element {
  const [settings, setSettings] = useState<TypeCheckSettings | null>(null);
  const [newWord, setNewWord] = useState('');
  const [dictionarySearch, setDictionarySearch] = useState('');
  const [importPreview, setImportPreview] = useState<DictionaryImportPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [message, setMessage] = useState('');
  const [hasError, setHasError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reportOpen, setReportOpen] = useState(
    () => new URLSearchParams(window.location.search).get('report') === 'issue',
  );
  const [reportText, setReportText] = useState<string | null>(null);
  const reportOpener = useRef<HTMLElement | null>(null);
  const hostname = sourceHostname();

  function showMessage(value: string, error = false): void {
    setMessage(value);
    setHasError(error);
  }

  function reportError(error: unknown): void {
    showMessage(error instanceof Error ? error.message : String(error), true);
  }

  async function loadSettings(): Promise<void> {
    setLoadError(false);
    try {
      const response = await runtimeRequest(Object.freeze({ type: 'settings:get' }));
      if (!response.ok || !('settings' in response)) {
        throw new Error(response.ok ? 'Settings response is missing.' : response.error);
      }
      setSettings(response.settings);
      showMessage('');
    } catch (error) {
      setLoadError(true);
      reportError(error);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (settings === null || !reportOpen) return;
    if (new URLSearchParams(window.location.search).get('report') === 'issue') {
      window.setTimeout(focusReport, 0);
    }
  }, [settings, reportOpen]);

  useEffect(() => {
    if (!reportOpen) return;
    function trapFocus(event: KeyboardEvent): void {
      if (event.key === 'Escape') { closeReport(); return; }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector<HTMLElement>('[data-testid="issue-report"]');
      const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input, select') ?? []);
      if (controls.length === 0) return;
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      const outsideControls = !controls.includes(document.activeElement as HTMLElement);
      if (event.shiftKey && (document.activeElement === first || outsideControls)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outsideControls)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', trapFocus);
    return () => document.removeEventListener('keydown', trapFocus);
  }, [reportOpen]);

  async function save(next: TypeCheckSettings): Promise<boolean> {
    if (saveLock.current || settings === null) return false;
    saveLock.current = true;
    setSaving(true);
    try {
      const authoritative = await updateSettings(settings, next);
      setSettings(authoritative);
      setReportText(null);
      showMessage('Settings saved.');
      return true;
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function generateReport(): Promise<void> {
    const response = await runtimeRequest(Object.freeze({
      type: 'diagnostics:get',
      hostname,
      capabilities: Object.freeze({
        webGpuAvailable: 'gpu' in navigator,
        webAssemblyAvailable: typeof WebAssembly === 'object',
        workerAvailable: typeof Worker === 'function',
      }),
    }));
    if (!response.ok || !('diagnostics' in response)) {
      throw new Error(response.ok ? 'Diagnostics response is missing.' : response.error);
    }
    setReportText(JSON.stringify(response.diagnostics, null, 2));
    showMessage('Diagnostic report generated locally. Review it before sharing.');
  }

  async function copyReport(): Promise<void> {
    if (reportText === null) return;
    await copyText(reportText);
    showMessage('Report copied to the clipboard.');
  }

  async function openGitHubIssue(): Promise<void> {
    if (GITHUB_ISSUE_URL === null) return;
    await browser.tabs.create({ url: GITHUB_ISSUE_URL });
  }

  function focusReport(): void {
    const heading = document.getElementById('report-heading');
    heading?.scrollIntoView();
    heading?.focus({ preventScroll: true });
  }

  function openReport(opener?: HTMLElement): void {
    reportOpener.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setReportOpen(true);
    window.setTimeout(focusReport, 0);
  }

  function closeReport(): void {
    setReportOpen(false);
    setReportText(null);
    window.setTimeout(() => reportOpener.current?.focus(), 0);
  }

  if (settings === null) {
    return <main className="shell options-loading"><p>Loading settings…</p><div role="alert">{message}</div>
      {loadError ? <button className="secondary" type="button" data-testid="retry-settings-load" onClick={() => void loadSettings()}>Retry</button> : null}
    </main>;
  }

  const currentSettings = settings;

  async function addWord(): Promise<void> {
    const word = newWord.trim();
    if (word.length === 0 || settings === null) return;
    if (await save({ ...settings, dictionary: [...new Set([...settings.dictionary, word])].sort() })) setNewWord('');
  }

  async function importDictionary(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    setImportPreview(null);
    setImportPreview(parseDictionaryImport(await file.text(), currentSettings.dictionary));
  }

  function downloadDictionary(): void {
    const url = URL.createObjectURL(new Blob([exportDictionary(currentSettings.dictionary)], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wordwarden-dictionary.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  const dictionaryWords = settings.dictionary.filter((word) => word.toLocaleLowerCase().includes(dictionarySearch.toLocaleLowerCase()));

  return (
    <main className="shell settings-page">
      <header className="settings-header" inert={reportOpen}>
        <div className="settings-header-inner">
          <div className="brand"><BrandMark />
            <h1>Settings</h1></div>
        </div>
        <p>Control private, on-device writing assistance. Changes save automatically.</p>
      </header>

      <div className={`settings-message ${hasError ? 'error' : ''}`}
        role={hasError ? 'alert' : 'status'} aria-live="polite">{message}</div>

      <div className="settings-layout" inert={reportOpen}>
        <nav className="settings-nav" aria-label="Settings sections">
          <a href="#general">General</a>
          <a href="#dictionary-sites">Dictionary &amp; websites</a>
          <a href="#advanced">Advanced</a>
          <a href="#support">Support &amp; privacy</a>
        </nav>

        <div className="settings-content">
          <section id="general" className="settings-section" aria-labelledby="general-heading">
            <div className="section-heading"><h2 id="general-heading">General</h2><p>Core spelling and grammar behaviour.</p></div>
            <div className="card setting-row">
              <div><h3>Spelling and grammar corrections</h3><p className="muted">Show local suggestions in supported text fields.</p></div>
              <Toggle enabled={settings.enabled} label="Spelling and grammar corrections" disabled={saving}
                onToggle={() => void save({ ...settings, enabled: !settings.enabled }).catch(reportError)} />
            </div>
            <div className="card stack">
              <div><h3>Language</h3><p className="muted">Choose the English spelling and grammar dialect.</p></div>
              <label>Dialect
                <select value={settings.dialect} data-testid="dialect" disabled={saving}
                  onChange={(event) => void save({ ...settings, dialect: event.target.value as EnglishDialect }).catch(reportError)}>
                  <option value="american">American English</option><option value="british">British English</option>
                  <option value="australian">Australian English</option><option value="canadian">Canadian English</option>
                </select>
              </label>
            </div>
            <div className="card setting-row">
              <div><h3>Typing stats</h3><p className="muted">Show today's typing speed and accuracy in the toolbar popup. Only counts are kept, never your writing.</p></div>
              <Toggle enabled={settings.typingStats} label="Typing stats" disabled={saving}
                onToggle={() => void save({ ...settings, typingStats: !settings.typingStats }).catch(reportError)} />
            </div>
            <div className="card setting-row">
              <div><h3>Ignore words in CAPITALS</h3><p className="muted">Skip acronyms and names such as SDE or FOMOD. Typos typed in caps lock are skipped too.</p></div>
              <Toggle enabled={settings.ignoreCapitals} label="Ignore words in CAPITALS" disabled={saving}
                onToggle={() => void save({ ...settings, ignoreCapitals: !settings.ignoreCapitals }).catch(reportError)} />
            </div>
            <div className="card stack">
              <div><h3>Keyboard</h3><p className="muted">Apply option 1, 2 or 3 of an open suggestion without the mouse. The suggestion opens when your cursor is in a marked word.</p></div>
              <label>Apply a suggestion with
                <select value={settings.applyShortcut} data-testid="apply-shortcut" disabled={saving}
                  onChange={(event) => void save({ ...settings, applyShortcut: event.target.value as ApplyShortcut }).catch(reportError)}>
                  <option value="alt">Alt + 1, 2 or 3</option>
                  <option value="alt-shift">Alt + Shift + 1, 2 or 3</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
            <div className="card stack">
              <div><h3>Colour vision</h3><p className="muted">Use underline colours that stay easy to tell apart with colour blindness.</p></div>
              <label>Underline colours
                <select value={settings.colorVision} data-testid="color-vision" disabled={saving}
                  onChange={(event) => void save({ ...settings, colorVision: event.target.value as ColorVision }).catch(reportError)}>
                  <option value="standard">Standard</option>
                  <option value="red-green">Red–green colour blindness (protanopia, deuteranopia)</option>
                  <option value="blue-yellow">Blue–yellow colour blindness (tritanopia)</option>
                  <option value="custom">Custom (set in Advanced editing below)</option>
                </select>
              </label>
              {settings.colorVision === 'custom' ? null : (
                <p className="vision-preview" data-vision={settings.colorVision} aria-hidden="true">
                  <span className="spelling">Spelling</span><span className="grammar">Grammar</span><span className="style">Style</span>
                </p>
              )}
            </div>
            <div className="card stack">
              <div><h3>Fix animation</h3><p className="muted">What shows on a word for a moment after you apply a suggestion.</p></div>
              <label>Animation
                <select value={settings.fixEffect} data-testid="fix-effect" disabled={saving}
                  onChange={(event) => void save({ ...settings, fixEffect: event.target.value as FixEffect }).catch(reportError)}>
                  <option value="waves">Green waves (standard)</option>
                  <option value="sparkle">Sparkle</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
            <UnderlineEditor value={settings.customUnderlines} active={settings.colorVision === 'custom'} disabled={saving}
              onApply={(customUnderlines) => void save({ ...settings, colorVision: 'custom', customUnderlines }).catch(reportError)} />
          </section>

          <section id="dictionary-sites" className="settings-section" aria-labelledby="dictionary-sites-heading">
            <div className="section-heading"><h2 id="dictionary-sites-heading">Dictionary &amp; websites</h2>
              <p>Manage personal words and sites where Wordwarden is disabled.</p></div>
            <div className="card">
              <h3>Personal dictionary</h3><p className="muted">{settings.dictionary.length} word{settings.dictionary.length === 1 ? '' : 's'} stored locally.</p>
              <div className="input-row spaced"><input type="text" value={newWord} data-testid="dictionary-word" disabled={saving}
                aria-label="Dictionary word" placeholder="Add a word, e.g. a name or brand" onChange={(event) => setNewWord(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void addWord().catch(reportError); }} />
                <button className="primary" type="button" disabled={saving} onClick={() => void addWord().catch(reportError)}>Add word</button></div>
              <div className="input-row spaced"><input type="search" value={dictionarySearch} aria-label="Search dictionary" placeholder="Search words" onChange={(event) => setDictionarySearch(event.target.value)} />
                <button className="secondary" type="button" onClick={downloadDictionary}>Export</button>
                <label className="secondary">Import<input data-testid="dictionary-import" type="file" accept="text/plain" disabled={saving} onChange={(event) => { void importDictionary(event.currentTarget.files?.[0]).catch(reportError); event.currentTarget.value = ''; }} /></label></div>
              {importPreview !== null ? <div className="warning"><p>Merge {importPreview.addedCount} new word{importPreview.addedCount === 1 ? '' : 's'} with the current dictionary?</p>
                <button className="primary" type="button" disabled={saving} onClick={() => void save({ ...settings, dictionary: importPreview.words }).then((saved) => { if (saved) setImportPreview(null); }).catch(reportError)}>Confirm merge</button>
                <button className="secondary" type="button" disabled={saving} onClick={() => setImportPreview(null)}>Cancel</button></div> : null}
              {settings.dictionary.length === 0 ? <p className="empty-state">No personal words added.</p> : dictionaryWords.length === 0 ? <p className="empty-state">No matching personal words.</p> : null}
              <ul className="chips" aria-label="Personal dictionary words">{dictionaryWords.map((word) => (
                <li className="chip" key={word}>{word}<button type="button" disabled={saving} aria-label={`Remove ${word}`}
                  onClick={() => void save({ ...settings, dictionary: settings.dictionary.filter((item) => item !== word) }).catch(reportError)}><CloseIcon /></button></li>
              ))}</ul>
            </div>
            <div className="card">
              <h3>Disabled websites</h3><p className="muted">Re-enable websites disabled from the popup.</p>
              {settings.disabledSites.length === 0 ? <p className="empty-state">No disabled websites.</p> : null}
              <ul className="chips" aria-label="Disabled websites">{settings.disabledSites.map((site) => (
                <li className="chip" key={site}>{site}<button type="button" disabled={saving} aria-label={`Enable ${site}`}
                  onClick={() => void save({ ...settings, disabledSites: settings.disabledSites.filter((item) => item !== site) }).catch(reportError)}><CloseIcon /></button></li>
              ))}</ul>
            </div>
          </section>

          <section id="advanced" className="settings-section" aria-labelledby="advanced-heading">
            <div className="section-heading"><h2 id="advanced-heading">Advanced</h2><p>Sites Wordwarden cannot check.</p></div>
            <div className="card"><h3>Google Docs and Sheets</h3><p className="muted">Docs and Sheets draw their text in a way Wordwarden cannot read, so it stays quiet there: no underlines, no pop-ups, and no changes to your documents.</p></div>
          </section>

          <section id="support" className="settings-section" aria-labelledby="support-heading">
            <div className="section-heading"><h2 id="support-heading">Support &amp; privacy</h2><p>Prepare a privacy-safe report or clear local extension data.</p></div>
            <div className="card support-card">
              <div className="setting-row"><div><h3>Report an issue</h3>
                <p className="muted">For broken websites, extension errors, incorrect behaviour, and browser compatibility problems.</p></div>
                <button className="secondary" type="button" aria-haspopup="dialog"
                  onClick={(event) => openReport(event.currentTarget)}>Report issue</button></div>
            </div>
            <div className="card setting-row"><div><h3>Reset ignored suggestions</h3><p className="muted">Shows previously ignored suggestions again without changing other settings.</p></div>
              <button className="secondary" type="button" disabled={saving || settings.ignoredIssueHashes.length === 0} onClick={() => { if (window.confirm('Reset ignored suggestions?')) void save({ ...settings, ignoredIssueHashes: [] }).catch(reportError); }}>Reset ignored suggestions</button></div>
            <div className="card danger-zone setting-row"><div><h3>Delete all local data</h3><p className="muted">Clears settings, dictionary, and ignored issues.</p></div>
              <button className="danger" type="button" disabled={saving} onClick={() => { if (!window.confirm('Delete all Wordwarden local data?')) return;
                void runtimeRequest(Object.freeze({ type: 'data:clear' })).then((response) => { if (!response.ok) throw new Error(response.error); window.location.reload(); }).catch(reportError);
              }}>Delete all data</button></div>
          </section>
        </div>
      </div>
      {reportOpen ? <div className="report-dialog-backdrop">
        <div id="report-panel" className="report-panel report-dialog" role="dialog" aria-modal="true"
          aria-labelledby="report-heading" aria-describedby="report-description" data-testid="issue-report">
          <div className="setting-row"><div><h3 id="report-heading" tabIndex={-1}>Diagnostic report</h3>
            <p id="report-description" className="muted">Generate a local diagnostic log to help investigate the issue. You can review it before sharing.</p></div>
            <button className="secondary compact" type="button" aria-label="Close diagnostic report" onClick={closeReport}>Close</button></div>
          <div className="privacy-note">The log includes useful extension, browser, capability, settings-count, and error-state details. It excludes writing, page contents, passwords, tokens, form data, dictionary words, and ignored-issue values. Nothing is uploaded automatically.</div>
          <button className="primary" type="button" onClick={() => void generateReport().catch(reportError)}>Generate diagnostic log</button>
          {reportText !== null ? <div className="report-preview"><label htmlFor="diagnostic-report">Review before sharing</label>
            <textarea id="diagnostic-report" readOnly rows={18} value={reportText} />
            <div className="button-row"><button className="primary" type="button" onClick={() => void copyReport().catch(reportError)}>Copy log</button>
              <button className="secondary" type="button" disabled={GITHUB_ISSUE_URL === null} aria-describedby={GITHUB_ISSUE_URL === null ? 'github-issue-unavailable' : undefined} onClick={() => void openGitHubIssue().catch(reportError)}>Open GitHub Issue</button>
              <button className="secondary" type="button" onClick={closeReport}>Close</button></div>
            {GITHUB_ISSUE_URL === null ? <p id="github-issue-unavailable" className="muted">GitHub issue reporting will be available after the project issue URL is configured.</p> : null}
            <p className="muted">Nothing is sent automatically. Copy the log and choose what to include when reporting the issue.</p></div> : null}
        </div>
      </div> : null}
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Options root element is missing.');
createRoot(root).render(<Options />);
