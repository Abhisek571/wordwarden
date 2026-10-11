import { describe, expect, it } from 'vitest';
import { isRuntimeRequest, isRuntimeResponse } from '#/core/messages';
import { DEFAULT_SETTINGS } from '#/core/settings';
import { createDiagnostics } from '#/core/diagnostics';

const environment = Object.freeze({
  generatedAt: '2026-08-31T00:00:00.000Z', extensionVersion: '1.1.0', userAgent: 'Mozilla/5.0 Firefox/142.0',
  platformOs: 'win', hostname: null, page: null, webAssemblyAvailable: true, recentErrors: Object.freeze([]),
});

describe('runtime request validation', () => {
  it('accepts complete requests and ignores unrelated fields', () => {
    expect(isRuntimeRequest({ type: 'settings:get', unrelated: true })).toBe(true);
    expect(
      isRuntimeRequest({ type: 'settings:replace', settings: DEFAULT_SETTINGS }),
    ).toBe(true);
    expect(isRuntimeRequest({ type: 'settings:update', patch: { enabled: false } })).toBe(true);
    expect(
      isRuntimeRequest({
        type: 'settings:update',
        patch: {
          dialect: 'australian',
          disabledSites: ['example.com'],
          dictionary: ['word'],
          ignoredIssueHashes: ['hash'],
          googleDocsWarningDismissed: true,
        },
      }),
    ).toBe(true);
    expect(
      isRuntimeRequest({ type: 'site:set-enabled', hostname: 'twitch.tv', enabled: false }),
    ).toBe(true);
    expect(isRuntimeRequest({ type: 'diagnostics:get', hostname: 'twitch.tv', tabId: 12, webAssemblyAvailable: true })).toBe(true);
    expect(isRuntimeRequest({ type: 'diagnostics:get', hostname: null, tabId: null, webAssemblyAvailable: false })).toBe(true);
    expect(isRuntimeRequest({ type: 'error:report', message: 'Grammar checker failed: out of memory' })).toBe(true);
  });

  it('rejects requests missing required payload fields', () => {
    expect(isRuntimeRequest({ type: 'settings:replace' })).toBe(false);
    expect(isRuntimeRequest({ type: 'settings:replace', settings: {} })).toBe(false);
    expect(isRuntimeRequest({ type: 'settings:update', patch: {} })).toBe(false);
    expect(isRuntimeRequest({ type: 'settings:update', patch: { enabled: 'no' } })).toBe(false);
    expect(isRuntimeRequest({ type: 'settings:update', patch: { dialect: 'unsupported' } })).toBe(false);
    expect(isRuntimeRequest({ type: 'settings:update', patch: { colorVision: 'red-green' } })).toBe(true);
    expect(isRuntimeRequest({ type: 'settings:update', patch: { colorVision: 'purple' } })).toBe(false);
    expect(isRuntimeRequest({ type: 'settings:update', patch: { customUnderlines: DEFAULT_SETTINGS.customUnderlines } })).toBe(true);
    expect(isRuntimeRequest({ type: 'settings:update', patch: { customUnderlines: { spelling: { color: '#fff' } } } })).toBe(false);
    expect(isRuntimeRequest({ type: 'settings:update', patch: { dictionary: ['word', 1] } })).toBe(false);
    expect(isRuntimeRequest({
      type: 'settings:update', patch: { dictionary: ['word'] }, base: { enabled: true },
    })).toBe(false);
    expect(isRuntimeRequest({
      type: 'settings:update', patch: { dictionary: ['word'] }, base: { dictionary: ['old', 1] },
    })).toBe(false);
    expect(isRuntimeRequest({
      type: 'settings:update', patch: { dictionary: ['word'] }, base: { ignoredIssueHashes: [] },
    })).toBe(false);
    expect(isRuntimeRequest({
      type: 'settings:update', patch: { dictionary: ['word'] }, base: {},
    })).toBe(false);
    expect(isRuntimeRequest({ type: 'settings:update', patch: { retiredSetting: true } })).toBe(false);
    expect(isRuntimeRequest({ type: 'settings:update', patch: null })).toBe(false);
    expect(isRuntimeRequest({ type: 'site:set-enabled', hostname: '', enabled: false })).toBe(false);
    expect(isRuntimeRequest({ type: 'site:set-enabled', hostname: 'https://example.com', enabled: false })).toBe(false);
    expect(isRuntimeRequest({ type: 'site:set-enabled', hostname: 'twitch.tv' })).toBe(false);
    expect(isRuntimeRequest({ type: 'diagnostics:get' })).toBe(false);
    expect(isRuntimeRequest({ type: 'diagnostics:get', hostname: 'https://example.com/path', tabId: null, webAssemblyAvailable: true })).toBe(false);
    expect(isRuntimeRequest({ type: 'diagnostics:get', hostname: null, tabId: -1, webAssemblyAvailable: true })).toBe(false);
    expect(isRuntimeRequest({ type: 'diagnostics:get', hostname: null, tabId: null })).toBe(false);
    expect(isRuntimeRequest({ type: 'error:report', message: 'x'.repeat(1001) })).toBe(false);
    expect(isRuntimeRequest({ type: 'error:report' })).toBe(false);
  });
});

describe('runtime response validation', () => {
  it('accepts valid success and error responses', () => {
    expect(isRuntimeResponse({ ok: true })).toBe(true);
    expect(isRuntimeResponse({ ok: true, settings: DEFAULT_SETTINGS })).toBe(true);
    expect(isRuntimeResponse({
      ok: true,
      diagnostics: createDiagnostics(DEFAULT_SETTINGS, environment),
    })).toBe(true);
    expect(isRuntimeResponse({ ok: false, error: 'Failed.' })).toBe(true);
  });

  it('rejects malformed response payloads', () => {
    expect(isRuntimeResponse({ ok: true, settings: {} })).toBe(false);
    expect(isRuntimeResponse({
      ok: true,
      settings: DEFAULT_SETTINGS,
      diagnostics: createDiagnostics(DEFAULT_SETTINGS, environment),
    })).toBe(false);
    expect(isRuntimeResponse({ ok: false })).toBe(false);
    expect(isRuntimeResponse({ error: 'Failed.' })).toBe(false);
  });
});
