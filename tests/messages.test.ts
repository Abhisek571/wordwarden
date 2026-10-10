import { describe, expect, it } from 'vitest';
import { isRuntimeRequest, isRuntimeResponse } from '#/core/messages';
import { DEFAULT_SETTINGS } from '#/core/settings';
import { createDiagnostics } from '#/core/diagnostics';

const capabilities = Object.freeze({
  webGpuAvailable: false,
  webAssemblyAvailable: true,
  workerAvailable: true,
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
    expect(isRuntimeRequest({ type: 'diagnostics:get', hostname: 'twitch.tv', capabilities })).toBe(true);
    expect(isRuntimeRequest({ type: 'diagnostics:get', hostname: null, capabilities })).toBe(true);
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
    expect(isRuntimeRequest({ type: 'diagnostics:get', hostname: 'https://example.com/path', capabilities })).toBe(false);
    expect(isRuntimeRequest({ type: 'diagnostics:get', hostname: null, capabilities: {} })).toBe(false);
  });
});

describe('runtime response validation', () => {
  it('accepts valid success and error responses', () => {
    expect(isRuntimeResponse({ ok: true })).toBe(true);
    expect(isRuntimeResponse({ ok: true, settings: DEFAULT_SETTINGS })).toBe(true);
    expect(isRuntimeResponse({
      ok: true,
      diagnostics: createDiagnostics(DEFAULT_SETTINGS, {
        generatedAt: '2026-08-31T00:00:00.000Z', extensionName: 'TypeCheck', extensionVersion: '0.1.0',
        manifestVersion: 3, userAgent: 'Mozilla/5.0 Firefox/142.0', platformOs: 'win',
        hostname: null, webGpuAvailable: false, webAssemblyAvailable: true, workerAvailable: true,
      }),
    })).toBe(true);
    expect(isRuntimeResponse({ ok: false, error: 'Failed.' })).toBe(true);
  });

  it('rejects malformed response payloads', () => {
    expect(isRuntimeResponse({ ok: true, settings: {} })).toBe(false);
    expect(isRuntimeResponse({
      ok: true,
      settings: DEFAULT_SETTINGS,
      diagnostics: createDiagnostics(DEFAULT_SETTINGS, {
        generatedAt: '2026-08-31T00:00:00.000Z', extensionName: 'TypeCheck', extensionVersion: '0.1.0',
        manifestVersion: 3, userAgent: 'Mozilla/5.0 Firefox/142.0', platformOs: 'win',
        hostname: null, webGpuAvailable: false, webAssemblyAvailable: true, workerAvailable: true,
      }),
    })).toBe(false);
    expect(isRuntimeResponse({ ok: false })).toBe(false);
    expect(isRuntimeResponse({ error: 'Failed.' })).toBe(false);
  });
});
