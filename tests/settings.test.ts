import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  detectDefaultDialect,
  isTypeCheckSettings,
  parseSettings,
} from '#/core/settings';

describe('settings validation', () => {
  it('detects supported browser dialects', () => {
    expect(detectDefaultDialect('en-AU')).toBe('australian');
    expect(detectDefaultDialect('en-GB')).toBe('british');
    expect(detectDefaultDialect('fr-FR')).toBe('american');
  });

  it('rejects weak external values and limits collections', () => {
    const parsed = parseSettings({
      enabled: 'yes',
      retiredSetting: true,
      dialect: 'unsupported',
      dictionary: ['valid', 7, null],
      ignoredIssueHashes: 'not-an-array',
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.dialect).toBe('american');
    expect(parsed.dictionary).toEqual(['valid']);
    expect(parsed.ignoredIssueHashes).toEqual([]);
  });

  it('keeps a valid colour-vision palette and falls back to standard', () => {
    expect(parseSettings({ colorVision: 'blue-yellow' }).colorVision).toBe('blue-yellow');
    expect(parseSettings({ colorVision: 'sepia' }).colorVision).toBe('standard');
    expect(parseSettings({}).colorVision).toBe('standard');
  });

  it('defaults to the Alt shortcut and skipping words in capitals', () => {
    expect(parseSettings({}).applyShortcut).toBe('alt');
    expect(parseSettings({ applyShortcut: 'alt-shift' }).applyShortcut).toBe('alt-shift');
    expect(parseSettings({ applyShortcut: 'tab' }).applyShortcut).toBe('alt');
    expect(parseSettings({}).ignoreCapitals).toBe(true);
    expect(parseSettings({ ignoreCapitals: false }).ignoreCapitals).toBe(false);
  });

  it('keeps valid custom underlines and repairs broken ones', () => {
    const custom = { spelling: { color: '#123abc', line: 'double', thickness: 4 } };
    const parsed = parseSettings({ colorVision: 'custom', customUnderlines: { ...custom, grammar: { color: 'red', line: 'wavy', thickness: 9 } } });
    expect(parsed.colorVision).toBe('custom');
    expect(parsed.customUnderlines.spelling).toEqual(custom.spelling);
    expect(parsed.customUnderlines.grammar).toEqual(DEFAULT_SETTINGS.customUnderlines.grammar);
    expect(parsed.customUnderlines.style).toEqual(DEFAULT_SETTINGS.customUnderlines.style);
    // Settings saved before the fix colour existed get the standard green.
    expect(parsed.customUnderlines.fix).toEqual(DEFAULT_SETTINGS.customUnderlines.fix);
  });

  it('defaults the fix animation to green waves', () => {
    expect(parseSettings({}).fixEffect).toBe('waves');
    expect(parseSettings({ fixEffect: 'sparkle' }).fixEffect).toBe('sparkle');
    expect(parseSettings({ fixEffect: 'fireworks' }).fixEffect).toBe('waves');
  });

  it('drops personal words too long to be words', () => {
    const long = 'x'.repeat(100_000);
    expect(parseSettings({ dictionary: ['Wordwarden', long, 'y'.repeat(80)] }).dictionary)
      .toEqual(['Wordwarden', 'y'.repeat(80)]);
  });

  it('requires complete settings at live message boundaries', () => {
    expect(isTypeCheckSettings(DEFAULT_SETTINGS)).toBe(true);
    expect(isTypeCheckSettings({ ...DEFAULT_SETTINGS, enabled: 'yes' })).toBe(false);
    expect(isTypeCheckSettings({ ...DEFAULT_SETTINGS, dictionary: ['word', 7] })).toBe(false);
    expect(isTypeCheckSettings({ enabled: true })).toBe(false);
  });
});
