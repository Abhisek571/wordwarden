import type { TypeCheckSettings } from './settings';
import { GRAMMAR_RUNTIME } from './model-config';

/** What the content script on the reporting tab knows. It never includes the page's text. */
export type PageStatus = Readonly<{
  hostname: string;
  editor: 'textarea' | 'input' | 'rich text' | 'none';
  checker: 'not started' | 'starting' | 'ready' | 'failed';
  lastCheckMs: number | null;
  underlines: number;
}>;

export type RecentError = Readonly<{ at: string; where: 'page' | 'background'; message: string }>;

export type Diagnostics = Readonly<{
  schemaVersion: 2;
  generatedAt: string;
  wordwarden: string;
  browser: Readonly<{ name: string; version: string; os: string }>;
  /** The site Settings was opened from; `page` is null when its tab could not be asked. */
  site: Readonly<{ hostname: string; on: boolean; page: Omit<PageStatus, 'hostname'> | null }> | null;
  settings: Readonly<{
    on: boolean;
    dialect: string;
    colorVision: string;
    fixEffect: string;
    applyShortcut: string;
    ignoreCapitals: boolean;
    typingStats: boolean;
    dictionaryWords: number;
    ignoredIssues: number;
    sitesTurnedOff: number;
  }>;
  checker: Readonly<{ grammar: string; webAssembly: boolean }>;
  recentErrors: readonly RecentError[];
}>;

export type DiagnosticEnvironment = Readonly<{
  generatedAt: string;
  extensionVersion: string;
  userAgent: string;
  platformOs: string;
  hostname: string | null;
  page: PageStatus | null;
  webAssemblyAvailable: boolean;
  recentErrors: readonly RecentError[];
}>;

export const RECENT_ERRORS_KEY = 'typecheck.recent-errors.v1';
export const RECENT_ERROR_LIMIT = 10;
const ERROR_MESSAGE_LENGTH = 160;
const EDITORS = new Set(['textarea', 'input', 'rich text', 'none']);
const CHECKER_STATES = new Set(['not started', 'starting', 'ready', 'failed']);

export function isSafeHostname(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 254) return false;
  // "example.org." is the same site as "example.org".
  if (value.endsWith('.')) return value.length > 1 && isSafeHostname(value.slice(0, -1));
  if (/^\[[0-9a-f:.]+\]$/iu.test(value)) return value.includes(':');
  const labels = value.split('.');
  if (labels.every((label) => /^\d+$/u.test(label))) {
    return labels.length === 4 && labels.every((label) => Number(label) <= 255);
  }
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      // Underscores are not allowed in domain names, but browsers open such hosts ("my_host.example").
      /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/iu.test(label),
  );
}

export function browserIdentity(userAgent: string): Readonly<{ name: string; version: string }> {
  const candidates = [
    Object.freeze({ name: 'Microsoft Edge', pattern: /Edg\/([\d.]+)/u }),
    Object.freeze({ name: 'Opera', pattern: /OPR\/([\d.]+)/u }),
    Object.freeze({ name: 'Vivaldi', pattern: /Vivaldi\/([\d.]+)/u }),
    Object.freeze({ name: 'Firefox', pattern: /Firefox\/([\d.]+)/u }),
    Object.freeze({ name: 'Chromium', pattern: /Chromium\/([\d.]+)/u }),
    Object.freeze({ name: 'Google Chrome', pattern: /Chrome\/([\d.]+)/u }),
  ];
  for (const candidate of candidates) {
    const match = candidate.pattern.exec(userAgent);
    if (match?.[1] !== undefined) {
      return Object.freeze({ name: candidate.name, version: match[1] });
    }
  }
  return Object.freeze({ name: 'Unknown', version: 'Unknown' });
}

/**
 * Error messages can quote what was being checked, so anything in quotes is removed and the rest is kept
 * short. What is left says where it went wrong, not what was written.
 */
export function sanitizeErrorMessage(message: string): string {
  const cleaned = message
    .replace(/"[^"]*"|“[^”]*”|'[^']{2,}'|`[^`]*`/gu, '…')
    .replace(/\s+/gu, ' ')
    .trim();
  return cleaned.length <= ERROR_MESSAGE_LENGTH ? cleaned : `${cleaned.slice(0, ERROR_MESSAGE_LENGTH - 1)}…`;
}

export function addRecentError(
  errors: readonly RecentError[],
  where: RecentError['where'],
  message: string,
  at: string,
): readonly RecentError[] {
  const entry = Object.freeze({ at, where, message: sanitizeErrorMessage(message) });
  return Object.freeze([...errors, entry].slice(-RECENT_ERROR_LIMIT));
}

export function isRecentError(value: unknown): value is RecentError {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.at === 'string' && !Number.isNaN(Date.parse(record.at)) &&
    (record.where === 'page' || record.where === 'background') &&
    typeof record.message === 'string' && record.message.length <= ERROR_MESSAGE_LENGTH;
}

export function parseRecentErrors(value: unknown): readonly RecentError[] {
  return Array.isArray(value) ? Object.freeze(value.filter(isRecentError).slice(-RECENT_ERROR_LIMIT)) : Object.freeze([]);
}

export function isPageStatus(value: unknown): value is PageStatus {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return isSafeHostname(record.hostname) &&
    typeof record.editor === 'string' && EDITORS.has(record.editor) &&
    typeof record.checker === 'string' && CHECKER_STATES.has(record.checker) &&
    (record.lastCheckMs === null || (typeof record.lastCheckMs === 'number' && record.lastCheckMs >= 0)) &&
    Number.isInteger(record.underlines) && (record.underlines as number) >= 0;
}

export function createDiagnostics(
  settings: TypeCheckSettings,
  environment: DiagnosticEnvironment,
): Diagnostics {
  const browser = browserIdentity(environment.userAgent);
  const { hostname, page } = environment;
  // A page answer only counts when it comes from the site Settings was opened for.
  const pageStatus = page !== null && page.hostname === hostname
    ? Object.freeze({ editor: page.editor, checker: page.checker, lastCheckMs: page.lastCheckMs, underlines: page.underlines })
    : null;
  return Object.freeze({
    schemaVersion: 2,
    generatedAt: environment.generatedAt,
    wordwarden: environment.extensionVersion,
    browser: Object.freeze({ ...browser, os: environment.platformOs }),
    site: hostname === null ? null : Object.freeze({
      hostname,
      on: settings.enabled && !settings.disabledSites.includes(hostname),
      page: pageStatus,
    }),
    settings: Object.freeze({
      on: settings.enabled,
      dialect: settings.dialect,
      colorVision: settings.colorVision,
      fixEffect: settings.fixEffect,
      applyShortcut: settings.applyShortcut,
      ignoreCapitals: settings.ignoreCapitals,
      typingStats: settings.typingStats,
      dictionaryWords: settings.dictionary.length,
      ignoredIssues: settings.ignoredIssueHashes.length,
      sitesTurnedOff: settings.disabledSites.length,
    }),
    checker: Object.freeze({
      grammar: GRAMMAR_RUNTIME.name,
      webAssembly: environment.webAssemblyAvailable,
    }),
    recentErrors: Object.freeze([...environment.recentErrors]),
  });
}

function isCount(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function isDiagnostics(value: unknown): value is Diagnostics {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const browser = record.browser as Record<string, unknown> | undefined;
  const site = record.site as Record<string, unknown> | null | undefined;
  const page = site?.page as Record<string, unknown> | null | undefined;
  const settings = record.settings as Record<string, unknown> | undefined;
  const checker = record.checker as Record<string, unknown> | undefined;
  return (
    record.schemaVersion === 2 &&
    typeof record.generatedAt === 'string' && !Number.isNaN(Date.parse(record.generatedAt)) &&
    typeof record.wordwarden === 'string' &&
    typeof browser?.name === 'string' && typeof browser.version === 'string' && typeof browser.os === 'string' &&
    (site === null || (
      isSafeHostname(site?.hostname) && typeof site.on === 'boolean' &&
      (page === null || isPageStatus({ ...page, hostname: site.hostname }))
    )) &&
    typeof settings?.on === 'boolean' &&
    typeof settings.dialect === 'string' &&
    typeof settings.colorVision === 'string' &&
    typeof settings.fixEffect === 'string' &&
    typeof settings.applyShortcut === 'string' &&
    typeof settings.ignoreCapitals === 'boolean' &&
    typeof settings.typingStats === 'boolean' &&
    isCount(settings.dictionaryWords) && isCount(settings.ignoredIssues) && isCount(settings.sitesTurnedOff) &&
    typeof checker?.grammar === 'string' && typeof checker.webAssembly === 'boolean' &&
    Array.isArray(record.recentErrors) && record.recentErrors.length <= RECENT_ERROR_LIMIT &&
    record.recentErrors.every(isRecentError)
  );
}
