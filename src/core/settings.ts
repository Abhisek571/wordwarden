import type { EnglishDialect } from './types';

/** Underline and badge colours: the standard palette, or one that stays distinct for colour-blind writers. */
export type ColorVision = 'standard' | 'red-green' | 'blue-yellow' | 'custom';

/** What shows on a word for a moment after a suggestion is applied. */
export type FixEffect = 'waves' | 'sparkle' | 'off';

/** Keys that apply option 1, 2 or 3 while a suggestion card is open. */
export type ApplyShortcut = 'alt' | 'alt-shift' | 'off';

export type UnderlineLine = 'solid' | 'dashed' | 'dotted' | 'double';
export type UnderlineMark = Readonly<{ color: string; line: UnderlineLine; thickness: number }>;
/** The writer's own underline for each kind of mistake, and the colour of the mark left by an applied fix,
 * used when colorVision is "custom". The fix mark uses only its colour and thickness. */
export type CustomUnderlines = Readonly<{
  spelling: UnderlineMark; grammar: UnderlineMark; style: UnderlineMark; fix: UnderlineMark;
}>;

export const UNDERLINE_KINDS = Object.freeze(['spelling', 'grammar', 'style'] as const);
export const MIN_UNDERLINE_THICKNESS = 1;
export const MAX_UNDERLINE_THICKNESS = 4;

export const DEFAULT_CUSTOM_UNDERLINES: CustomUnderlines = Object.freeze({
  spelling: Object.freeze({ color: '#d32f2f', line: 'solid', thickness: 2 }),
  grammar: Object.freeze({ color: '#e08a00', line: 'solid', thickness: 2 }),
  style: Object.freeze({ color: '#1e6fd9', line: 'dotted', thickness: 2 }),
  fix: Object.freeze({ color: '#2f7d5b', line: 'solid', thickness: 2 }),
});

export type TypeCheckSettings = Readonly<{
  enabled: boolean;
  dialect: EnglishDialect;
  disabledSites: readonly string[];
  dictionary: readonly string[];
  ignoredIssueHashes: readonly string[];
  googleDocsWarningDismissed: boolean;
  colorVision: ColorVision;
  customUnderlines: CustomUnderlines;
  applyShortcut: ApplyShortcut;
  ignoreCapitals: boolean;
  /** Counts today's typing speed and accuracy for the popup. */
  typingStats: boolean;
  fixEffect: FixEffect;
}>;

export const DEFAULT_SETTINGS: TypeCheckSettings = Object.freeze({
  enabled: true,
  dialect: detectDefaultDialect(navigator.language),
  disabledSites: Object.freeze([]),
  dictionary: Object.freeze([]),
  ignoredIssueHashes: Object.freeze([]),
  googleDocsWarningDismissed: false,
  colorVision: 'standard',
  customUnderlines: DEFAULT_CUSTOM_UNDERLINES,
  applyShortcut: 'alt',
  ignoreCapitals: true,
  typingStats: true,
  fixEffect: 'waves',
});

// Commonwealth English is written with British spelling, New Zealand's closest to Australia's. American spelling is
// for the US and the places that follow it (the Philippines, Liberia) and for other languages.
export function detectDefaultDialect(locale: string): EnglishDialect {
  const normalized = locale.toLowerCase();
  if (normalized.includes('-gb')) return 'british';
  if (normalized.includes('-au') || normalized.includes('-nz')) return 'australian';
  if (normalized.includes('-ca')) return 'canadian';
  if (/^en-(?:ie|za|in|sg|hk|my|ng|ke|gh|pk|mt|jm|tt|bz|bs|zw|na|bw|zm|ug|tz|cy|gi|im|je|gg)(?![a-z])/u.test(normalized)) {
    return 'british';
  }
  return 'american';
}

export function isDialect(value: unknown): value is EnglishDialect {
  return (
    value === 'american' ||
    value === 'british' ||
    value === 'australian' ||
    value === 'canadian'
  );
}

export function isColorVision(value: unknown): value is ColorVision {
  return value === 'standard' || value === 'red-green' || value === 'blue-yellow' || value === 'custom';
}

export function isFixEffect(value: unknown): value is FixEffect {
  return value === 'waves' || value === 'sparkle' || value === 'off';
}

export function isApplyShortcut(value: unknown): value is ApplyShortcut {
  return value === 'alt' || value === 'alt-shift' || value === 'off';
}

function isUnderlineMark(value: unknown): value is UnderlineMark {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.color === 'string' && /^#[0-9a-f]{6}$/iu.test(record.color) &&
    (record.line === 'solid' || record.line === 'dashed' || record.line === 'dotted' || record.line === 'double') &&
    Number.isInteger(record.thickness) &&
    (record.thickness as number) >= MIN_UNDERLINE_THICKNESS && (record.thickness as number) <= MAX_UNDERLINE_THICKNESS;
}

export function isCustomUnderlines(value: unknown): value is CustomUnderlines {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return [...UNDERLINE_KINDS, 'fix'].every((kind) => isUnderlineMark(record[kind]));
}

function parseCustomUnderlines(value: unknown): CustomUnderlines {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return Object.freeze({
    spelling: isUnderlineMark(record.spelling) ? Object.freeze({ ...record.spelling }) : DEFAULT_CUSTOM_UNDERLINES.spelling,
    grammar: isUnderlineMark(record.grammar) ? Object.freeze({ ...record.grammar }) : DEFAULT_CUSTOM_UNDERLINES.grammar,
    style: isUnderlineMark(record.style) ? Object.freeze({ ...record.style }) : DEFAULT_CUSTOM_UNDERLINES.style,
    fix: isUnderlineMark(record.fix) ? Object.freeze({ ...record.fix }) : DEFAULT_CUSTOM_UNDERLINES.fix,
  });
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every((item) => typeof item === 'string')
  );
}

export function isTypeCheckSettings(value: unknown): value is TypeCheckSettings {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.enabled === 'boolean' &&
    isDialect(record.dialect) &&
    isStringArray(record.disabledSites) &&
    isStringArray(record.dictionary) &&
    isStringArray(record.ignoredIssueHashes) &&
    typeof record.googleDocsWarningDismissed === 'boolean' &&
    isColorVision(record.colorVision) &&
    isCustomUnderlines(record.customUnderlines) &&
    isApplyShortcut(record.applyShortcut) &&
    typeof record.ignoreCapitals === 'boolean' &&
    typeof record.typingStats === 'boolean' &&
    isFixEffect(record.fixEffect)
  );
}

/**
 * The longest personal word kept. The spelling ranker stores every beginning of a personal word, so its memory grows
 * with the square of the length; a pasted 100,000-letter "word" ran the background out of memory on every check.
 */
export const MAX_DICTIONARY_WORD_LENGTH = 80;

/** The most dictionary words, ignored suggestions or turned-off sites kept. */
export const MAX_SETTINGS_LIST_LENGTH = 10_000;

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return Object.freeze(
    value.filter((item): item is string => typeof item === 'string').slice(0, 10_000),
  );
}

export function parseSettings(value: unknown): TypeCheckSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS;
  const record = value as Record<string, unknown>;
  return Object.freeze({
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.enabled,
    dialect: isDialect(record.dialect) ? record.dialect : DEFAULT_SETTINGS.dialect,
    disabledSites: stringArray(record.disabledSites),
    dictionary: Object.freeze(stringArray(record.dictionary).filter((word) => word.length <= MAX_DICTIONARY_WORD_LENGTH)),
    ignoredIssueHashes: stringArray(record.ignoredIssueHashes),
    googleDocsWarningDismissed:
      typeof record.googleDocsWarningDismissed === 'boolean'
        ? record.googleDocsWarningDismissed
        : DEFAULT_SETTINGS.googleDocsWarningDismissed,
    colorVision: isColorVision(record.colorVision) ? record.colorVision : DEFAULT_SETTINGS.colorVision,
    customUnderlines: parseCustomUnderlines(record.customUnderlines),
    applyShortcut: isApplyShortcut(record.applyShortcut) ? record.applyShortcut : DEFAULT_SETTINGS.applyShortcut,
    ignoreCapitals: typeof record.ignoreCapitals === 'boolean' ? record.ignoreCapitals : DEFAULT_SETTINGS.ignoreCapitals,
    typingStats: typeof record.typingStats === 'boolean' ? record.typingStats : DEFAULT_SETTINGS.typingStats,
    fixEffect: isFixEffect(record.fixEffect) ? record.fixEffect : DEFAULT_SETTINGS.fixEffect,
  });
}

export function mergeSettings(
  current: TypeCheckSettings,
  patch: Partial<TypeCheckSettings>,
): TypeCheckSettings {
  return parseSettings({ ...current, ...patch });
}
