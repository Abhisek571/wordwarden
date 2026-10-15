import { describe, expect, it } from 'vitest';
import {
  addRecentError, browserIdentity, createDiagnostics, isDiagnostics, isSafeHostname, sanitizeErrorMessage,
} from '#/core/diagnostics';
import { DEFAULT_SETTINGS } from '#/core/settings';

const page = Object.freeze({
  hostname: 'editor.example.com', editor: 'rich text', checker: 'ready', lastCheckMs: 42, underlines: 3,
} as const);
const environment = Object.freeze({
  generatedAt: '2026-08-31T00:00:00.000Z',
  extensionVersion: '1.1.0',
  userAgent: 'Mozilla/5.0 Firefox/142.0',
  platformOs: 'win',
  hostname: 'editor.example.com',
  page,
  webAssemblyAvailable: true,
  recentErrors: Object.freeze([]),
});

describe('diagnostics', () => {
  it('parses common browser identities without browser-specific APIs', () => {
    expect(browserIdentity('Mozilla/5.0 Firefox/142.0')).toEqual({ name: 'Firefox', version: '142.0' });
    expect(browserIdentity('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0')).toEqual({
      name: 'Microsoft Edge',
      version: '140.0',
    });
    expect(browserIdentity('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36')).toEqual({
      name: 'Google Chrome',
      version: '140.0.0.0',
    });
    expect(browserIdentity('Unknown agent')).toEqual({ name: 'Unknown', version: 'Unknown' });
  });

  it('includes useful state without exposing stored values or page content', () => {
    const diagnostics = createDiagnostics(
      {
        ...DEFAULT_SETTINGS,
        dictionary: ['PrivateProjectName'],
        disabledSites: ['private.example'],
        ignoredIssueHashes: ['secret-hash'],
      },
      environment,
    );
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics.wordwarden).toBe('1.1.0');
    expect(diagnostics.browser).toEqual({ name: 'Firefox', version: '142.0', os: 'win' });
    expect(diagnostics.site).toEqual({
      hostname: 'editor.example.com',
      on: true,
      page: { editor: 'rich text', checker: 'ready', lastCheckMs: 42, underlines: 3 },
    });
    expect(diagnostics.settings.dictionaryWords).toBe(1);
    expect(diagnostics.settings.sitesTurnedOff).toBe(1);
    expect(diagnostics.checker).toEqual({ grammar: 'Wordwarden core', webAssembly: true });
    expect(diagnostics.recentErrors).toEqual([]);
    expect(isDiagnostics(diagnostics)).toBe(true);
    expect(serialized).not.toContain('PrivateProjectName');
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('secret-hash');
    expect(serialized).not.toContain(environment.userAgent);
  });

  it('accepts hostnames but rejects URLs and path data', () => {
    expect(isSafeHostname('docs.example.com')).toBe(true);
    expect(isSafeHostname('localhost')).toBe(true);
    expect(isSafeHostname('[::1]')).toBe(true);
    expect(isSafeHostname('127.0.0.1')).toBe(true);
    expect(isSafeHostname('a..b')).toBe(false);
    expect(isSafeHostname('-')).toBe(false);
    expect(isSafeHostname('https://example.com/private')).toBe(false);
    expect(isSafeHostname('example.com/path')).toBe(false);
    expect(isSafeHostname(null)).toBe(false);
  });
});

describe('diagnostic details', () => {
  it('only uses a page answer from the site Settings was opened for', () => {
    const elsewhere = createDiagnostics(DEFAULT_SETTINGS, { ...environment, page: { ...page, hostname: 'other.example' } });
    expect(elsewhere.site?.page).toBeNull();
    const noSite = createDiagnostics(DEFAULT_SETTINGS, { ...environment, hostname: null });
    expect(noSite.site).toBeNull();
    expect(isDiagnostics(noSite)).toBe(true);
  });

  it('removes quoted text from error messages and keeps them short', () => {
    expect(sanitizeErrorMessage('Could not add word: "my secret draft" was rejected')).toBe('Could not add word: … was rejected');
    expect(sanitizeErrorMessage('Lint failed on “private words” here')).toBe('Lint failed on … here');
    expect(sanitizeErrorMessage('x'.repeat(400)).length).toBe(160);
  });

  it('keeps only the ten most recent errors', () => {
    let errors = addRecentError([], 'page', 'first', '2026-08-31T00:00:00.000Z');
    for (let index = 0; index < 12; index += 1) {
      errors = addRecentError(errors, 'background', `error ${index}`, '2026-08-31T00:00:01.000Z');
    }
    expect(errors).toHaveLength(10);
    expect(errors[0]?.message).toBe('error 2');
    expect(errors.at(-1)).toEqual({ at: '2026-08-31T00:00:01.000Z', where: 'background', message: 'error 11' });
  });
});
