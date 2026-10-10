import type { TypeCheckSettings } from './settings';
import { GRAMMAR_RUNTIME } from './model-config';

export type Diagnostics = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  extension: Readonly<{
    name: string;
    version: string;
    manifestVersion: number;
  }>;
  browser: Readonly<{
    name: string;
    version: string;
  }>;
  platform: Readonly<{
    os: string;
  }>;
  website: Readonly<{
    hostname: string | null;
    typeCheckEnabled: boolean | null;
  }>;
  settings: Readonly<{
    enabled: boolean;
    dialect: string;
    googleDocsWarningDismissed: boolean;
    disabledSiteCount: number;
    dictionaryWordCount: number;
    ignoredIssueCount: number;
  }>;
  features: Readonly<{
    spelling: boolean;
    grammar: boolean;
    googleDocsIntegration: 'experimental';
  }>;
  runtime: Readonly<{
    grammar: typeof GRAMMAR_RUNTIME;
    webGpuAvailable: boolean;
    webAssemblyAvailable: boolean;
    workerAvailable: boolean;
  }>;
  recentErrors: Readonly<{
    tracked: false;
    entries: readonly string[];
  }>;
}>;

export type DiagnosticEnvironment = Readonly<{
  generatedAt: string;
  extensionName: string;
  extensionVersion: string;
  manifestVersion: number;
  userAgent: string;
  platformOs: string;
  hostname: string | null;
  webGpuAvailable: boolean;
  webAssemblyAvailable: boolean;
  workerAvailable: boolean;
}>;

export function isSafeHostname(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) return false;
  if (/^\[[0-9a-f:.]+\]$/iu.test(value)) return value.includes(':');
  const labels = value.split('.');
  if (labels.every((label) => /^\d+$/u.test(label))) {
    return labels.length === 4 && labels.every((label) => Number(label) <= 255);
  }
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label),
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

export function createDiagnostics(
  settings: TypeCheckSettings,
  environment: DiagnosticEnvironment,
): Diagnostics {
  const browser = browserIdentity(environment.userAgent);
  const siteEnabled =
    environment.hostname === null
      ? null
      : settings.enabled && !settings.disabledSites.includes(environment.hostname);
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: environment.generatedAt,
    extension: Object.freeze({
      name: environment.extensionName,
      version: environment.extensionVersion,
      manifestVersion: environment.manifestVersion,
    }),
    browser,
    platform: Object.freeze({ os: environment.platformOs }),
    website: Object.freeze({ hostname: environment.hostname, typeCheckEnabled: siteEnabled }),
    settings: Object.freeze({
      enabled: settings.enabled,
      dialect: settings.dialect,
      googleDocsWarningDismissed: settings.googleDocsWarningDismissed,
      disabledSiteCount: settings.disabledSites.length,
      dictionaryWordCount: settings.dictionary.length,
      ignoredIssueCount: settings.ignoredIssueHashes.length,
    }),
    features: Object.freeze({
      spelling: settings.enabled,
      grammar: settings.enabled,
      googleDocsIntegration: 'experimental',
    }),
    runtime: Object.freeze({
      grammar: GRAMMAR_RUNTIME,
      webGpuAvailable: environment.webGpuAvailable,
      webAssemblyAvailable: environment.webAssemblyAvailable,
      workerAvailable: environment.workerAvailable,
    }),
    recentErrors: Object.freeze({ tracked: false, entries: Object.freeze([]) }),
  });
}

export function isDiagnostics(value: unknown): value is Diagnostics {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const extension = record.extension as Record<string, unknown> | undefined;
  const browser = record.browser as Record<string, unknown> | undefined;
  const platform = record.platform as Record<string, unknown> | undefined;
  const website = record.website as Record<string, unknown> | undefined;
  const settings = record.settings as Record<string, unknown> | undefined;
  const features = record.features as Record<string, unknown> | undefined;
  const runtime = record.runtime as Record<string, unknown> | undefined;
  const grammar = runtime?.grammar as Record<string, unknown> | undefined;
  const recentErrors = record.recentErrors as Record<string, unknown> | undefined;
  return (
    record.schemaVersion === 1 &&
    typeof record.generatedAt === 'string' &&
    typeof extension?.name === 'string' &&
    typeof extension.version === 'string' &&
    typeof extension.manifestVersion === 'number' &&
    typeof browser?.name === 'string' &&
    typeof browser.version === 'string' &&
    typeof platform?.os === 'string' &&
    (website?.hostname === null || isSafeHostname(website?.hostname)) &&
    (website?.typeCheckEnabled === null || typeof website?.typeCheckEnabled === 'boolean') &&
    typeof settings?.enabled === 'boolean' &&
    typeof settings.dialect === 'string' &&
    typeof settings.googleDocsWarningDismissed === 'boolean' &&
    typeof settings.disabledSiteCount === 'number' &&
    typeof settings.dictionaryWordCount === 'number' &&
    typeof settings.ignoredIssueCount === 'number' &&
    typeof features?.spelling === 'boolean' &&
    typeof features.grammar === 'boolean' &&
    features.googleDocsIntegration === 'experimental' &&
    typeof grammar?.name === 'string' &&
    typeof grammar.version === 'string' &&
    typeof grammar.backend === 'string' &&
    typeof runtime?.webGpuAvailable === 'boolean' &&
    typeof runtime.webAssemblyAvailable === 'boolean' &&
    typeof runtime.workerAvailable === 'boolean' &&
    recentErrors?.tracked === false &&
    Array.isArray(recentErrors.entries) &&
    recentErrors.entries.length === 0 &&
    Number.isInteger(extension.manifestVersion) &&
    extension.manifestVersion >= 2 &&
    Number.isInteger(settings.disabledSiteCount) &&
    settings.disabledSiteCount >= 0 &&
    Number.isInteger(settings.dictionaryWordCount) &&
    settings.dictionaryWordCount >= 0 &&
    Number.isInteger(settings.ignoredIssueCount) &&
    settings.ignoredIssueCount >= 0 &&
    !Number.isNaN(Date.parse(record.generatedAt))
  );
}
