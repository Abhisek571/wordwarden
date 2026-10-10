import { describe, expect, it } from 'vitest';
import { browserIdentity, createDiagnostics, isSafeHostname } from '#/core/diagnostics';
import { DEFAULT_SETTINGS } from '#/core/settings';

const environment = Object.freeze({
  generatedAt: '2026-08-31T00:00:00.000Z',
  extensionName: 'TypeCheck',
  extensionVersion: '0.1.0',
  manifestVersion: 3,
  userAgent: 'Mozilla/5.0 Firefox/142.0',
  platformOs: 'win',
  hostname: 'editor.example.com',
  webGpuAvailable: false,
  webAssemblyAvailable: true,
  workerAvailable: true,
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

    expect(diagnostics.extension.manifestVersion).toBe(3);
    expect(diagnostics.website).toEqual({ hostname: 'editor.example.com', typeCheckEnabled: true });
    expect(diagnostics.settings.dictionaryWordCount).toBe(1);
    expect(diagnostics.runtime.webAssemblyAvailable).toBe(true);
    expect(diagnostics.recentErrors).toEqual({ tracked: false, entries: [] });
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
