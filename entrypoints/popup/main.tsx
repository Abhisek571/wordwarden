import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import type { TypeCheckSettings } from '#/core/settings';
import { loadTypingStats } from '#/core/storage';
import { accuracyPercent, wordsPerMinute, type TypingStats } from '#/core/typing-stats';
import { isSafeHostname } from '#/core/diagnostics';
import { runtimeRequest } from '#/ui/runtime';
import { updateSettings } from '#/ui/settings-update';
import { BrandMark } from '#/ui/brand';
import '#/ui/app.css';

// Online office editors (Google Docs, Sheets and Slides, Microsoft 365 on the web) keep the document text out of
// reach of extensions, so the popup says so instead of claiming to check the page.
const LIMITED_SITES = Object.freeze(['docs.google.com', 'word.cloud.microsoft', 'excel.cloud.microsoft',
  'powerpoint.cloud.microsoft', 'officeapps.live.com']);

function isLimitedSite(hostname: string): boolean {
  return LIMITED_SITES.some((site) => hostname === site || hostname.endsWith(`.${site}`));
}

function Toggle(
  props: Readonly<{ enabled: boolean; label: string; onToggle: () => void; disabled?: boolean }>,
): React.JSX.Element {
  return (
    <button
      className={`toggle ${props.enabled ? 'on' : ''}`}
      type="button"
      role="switch"
      aria-checked={props.enabled}
      aria-label={props.label}
      data-testid={`toggle-${props.label.toLowerCase().replaceAll(' ', '-')}`}
      onClick={props.onToggle}
      disabled={props.disabled}
    />
  );
}

function TypingToday(props: Readonly<{ stats: TypingStats | null }>): React.JSX.Element {
  const stats = props.stats;
  const wpm = stats === null ? null : wordsPerMinute(stats.characters, stats.typingMs);
  const accuracy = stats === null ? null : accuracyPercent(stats.characters / 5, stats.mistakes);
  return (
    <section className="card typing-today" aria-labelledby="typing-today-heading" data-testid="typing-today">
      <h2 id="typing-today-heading">Typing today</h2>
      <dl>
        <div><dt>WPM</dt><dd data-testid="today-wpm">{wpm ?? '–'}</dd></div>
        <div><dt>Accuracy</dt><dd data-testid="today-accuracy">{accuracy === null ? '–' : `${accuracy}%`}</dd></div>
      </dl>
    </section>
  );
}

function Popup(): React.JSX.Element {
  const [settings, setSettings] = useState<TypeCheckSettings | null>(null);
  const [hostname, setHostname] = useState<string | null>(null);
  const [typing, setTyping] = useState<TypingStats | null>(null);
  const [message, setMessage] = useState('');
  const [hasError, setHasError] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function reportError(error: unknown): void {
    setHasError(true);
    setMessage(errorMessage(error));
  }

  async function load(): Promise<void> {
    setLoadError(null);
    try {
      const [response, tabs] = await Promise.all([
        runtimeRequest(Object.freeze({ type: 'settings:get' })),
        browser.tabs.query({ active: true, currentWindow: true }),
      ]);
      if (!response.ok || !('settings' in response)) {
        throw new Error(response.ok ? 'Settings response is missing.' : response.error);
      }
      setSettings(response.settings);
      // The numbers are a nicety: if they cannot be read the popup still works.
      void loadTypingStats().then(setTyping, () => setTyping(null));
      const url = tabs[0]?.url;
      if (url === undefined) return;
      try {
        const parsedUrl = new URL(url);
        const parsedHostname = parsedUrl.hostname.toLowerCase();
        setHostname(
          (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') && isSafeHostname(parsedHostname)
            ? parsedHostname
            : null,
        );
      } catch {
        setHostname(null);
      }
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function replaceSettings(next: TypeCheckSettings, successMessage: string): Promise<void> {
    const current = settings;
    if (current === null || isSaving) return;
    setIsSaving(true);
    setHasError(false);
    setMessage('Saving…');
    try {
      const saved = await updateSettings(current, next);
      setSettings(saved);
      setMessage(successMessage);
    } catch (error) {
      reportError(error);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleSite(): Promise<void> {
    if (settings === null || hostname === null || !settings.enabled || isSaving) return;
    setIsSaving(true);
    setHasError(false);
    setMessage('Saving…');
    try {
      const enabled = settings.disabledSites.includes(hostname);
      const response = await runtimeRequest(
        Object.freeze({ type: 'site:set-enabled', hostname, enabled }),
      );
      if (!response.ok || !('settings' in response)) {
        throw new Error(response.ok ? 'Missing settings response.' : response.error);
      }
      setSettings(response.settings);
      // Turning a site off applies live; a page that never started needs a reload to start.
      setMessage(enabled ? 'On for this site. Reload the page to start checking.' : 'Off for this site.');
    } catch (error) {
      reportError(error);
    } finally {
      setIsSaving(false);
    }
  }

  async function openPlayground(): Promise<void> {
    await browser.tabs.create({ url: browser.runtime.getURL('/playground.html') });
  }

  async function openSettings(reportIssue = false): Promise<void> {
    const url = new URL(browser.runtime.getURL('/options.html'));
    if (hostname !== null) url.searchParams.set('site', hostname);
    if (reportIssue) {
      url.searchParams.set('report', 'issue');
      url.hash = 'support';
    }
    await browser.tabs.create({ url: url.href });
    window.close();
  }

  if (settings === null) {
    return (
      <main className="shell popup">
        <p>Loading local settings…</p>
        {loadError === null ? null : <div role="alert">{loadError}</div>}
        {loadError === null ? null : (
          <button type="button" className="secondary" aria-label="Retry loading settings" onClick={() => void load()}>
            Retry
          </button>
        )}
      </main>
    );
  }

  const siteEnabled = hostname !== null && !settings.disabledSites.includes(hostname);
  const siteControlDisabled = hostname === null || !settings.enabled || isSaving;
  const pageStatus = hostname === null
    ? 'This website is browser-restricted or unsupported.'
    : !settings.enabled
      ? 'Off everywhere. Turn on Corrections to check this site.'
      : !siteEnabled
        ? 'Off on this site.'
        : isLimitedSite(hostname)
          ? 'Known issue: this site draws its own editor, so Wordwarden cannot read or fix its text.'
          : 'Checking text boxes on this site.';

  return (
    <main className="shell popup">
      <header className="popup-header">
        <div className="brand">
          <BrandMark />
          <h1>Wordwarden</h1>
        </div>
        <button
          className="secondary compact"
          type="button"
          onClick={() => void openSettings().catch(reportError)}
        >
          Settings
        </button>
      </header>
      <div className="privacy-line"><span className="privacy-ring" aria-hidden="true" />Your writing stays on this device</div>

      <section className="card">
        <div className="row">
          <div><h2>Corrections</h2><p className="muted">Better spelling and grammar suggestions while you type.</p></div>
          <Toggle
            enabled={settings.enabled}
            label="Wordwarden globally"
            disabled={isSaving}
            onToggle={() => void replaceSettings(
              { ...settings, enabled: !settings.enabled },
              settings.enabled ? 'Turned off.' : 'Turned on. Reload open pages to start checking.',
            )}
          />
        </div>
        <div className="row">
          <div className="site" title={hostname ?? undefined}>{hostname ?? 'Unavailable on this website'}</div>
          <Toggle enabled={siteEnabled} disabled={siteControlDisabled} label="Current site" onToggle={() => void toggleSite()} />
        </div>
        <p className="muted" data-testid="page-status">{pageStatus}</p>
      </section>

      {settings.typingStats ? <TypingToday stats={typing} /> : null}

      <div className="message" role={hasError ? 'alert' : 'status'} aria-live="polite">{message}</div>
      <button className="secondary wide playground-button" type="button" onClick={() => void openPlayground().catch(reportError)}>
        Open typing test page
      </button>
      <div className="footer">
        <button className="link-button" type="button" onClick={() => void openSettings(true).catch(reportError)}>
          Report issue
        </button>
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Popup root element is missing.');
createRoot(root).render(<Popup />);
