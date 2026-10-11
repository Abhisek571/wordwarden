import { isApplyShortcut, isColorVision, isCustomUnderlines, isDialect, isFixEffect, isTypeCheckSettings, type TypeCheckSettings } from './settings';
import { isDiagnostics, isSafeHostname, type Diagnostics } from './diagnostics';
import { isTypingStatsDelta, type TypingStatsDelta } from './typing-stats';
export type { Diagnostics } from './diagnostics';

/** Sent by the background to the content script of one tab; answered with a PageStatus. */
export const PAGE_STATUS_REQUEST = 'page:status';
const MAX_ERROR_REPORT_LENGTH = 1000;

export type SettingsPatch = Readonly<Partial<TypeCheckSettings>>;
export type SettingsConflictBase = Readonly<Partial<Pick<
  TypeCheckSettings,
  'disabledSites' | 'dictionary' | 'ignoredIssueHashes'
>>>;

const SETTINGS_PATCH_FIELDS = new Set<keyof TypeCheckSettings>([
  'enabled',
  'dialect',
  'colorVision',
  'customUnderlines',
  'applyShortcut',
  'ignoreCapitals',
  'typingStats',
  'fixEffect',
  'disabledSites',
  'dictionary',
  'ignoredIssueHashes',
  'googleDocsWarningDismissed',
]);

const SETTINGS_CONFLICT_BASE_FIELDS = new Set<keyof SettingsConflictBase>([
  'disabledSites',
  'dictionary',
  'ignoredIssueHashes',
]);

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 10_000 && value.every((item) => typeof item === 'string');
}

export function isSettingsPatch(value: unknown): value is SettingsPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const patch = value as Record<string, unknown>;
  const fields = Object.keys(patch);
  if (fields.length === 0 || fields.some((field) => !SETTINGS_PATCH_FIELDS.has(field as keyof TypeCheckSettings))) {
    return false;
  }
  return fields.every((field) => {
    const fieldValue = patch[field];
    switch (field) {
      case 'enabled':
      case 'googleDocsWarningDismissed':
      case 'ignoreCapitals':
      case 'typingStats':
        return typeof fieldValue === 'boolean';
      case 'dialect':
        return isDialect(fieldValue);
      case 'colorVision':
        return isColorVision(fieldValue);
      case 'customUnderlines':
        return isCustomUnderlines(fieldValue);
      case 'applyShortcut':
        return isApplyShortcut(fieldValue);
      case 'fixEffect':
        return isFixEffect(fieldValue);
      case 'disabledSites':
      case 'dictionary':
      case 'ignoredIssueHashes':
        return isStringArray(fieldValue);
      default:
        return false;
    }
  });
}

function isSettingsConflictBase(value: unknown): value is SettingsConflictBase {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const base = value as Record<string, unknown>;
  const fields = Object.keys(base);
  return fields.length > 0 && fields.every((field) =>
    SETTINGS_CONFLICT_BASE_FIELDS.has(field as keyof SettingsConflictBase) && isStringArray(base[field]),
  );
}

export type RuntimeRequest =
  | Readonly<{ type: 'settings:get' }>
  | Readonly<{ type: 'settings:replace'; settings: TypeCheckSettings }>
  | Readonly<{ type: 'settings:update'; patch: SettingsPatch; base?: SettingsConflictBase }>
  | Readonly<{ type: 'site:set-enabled'; hostname: string; enabled: boolean }>
  | Readonly<{
      type: 'diagnostics:get';
      hostname: string | null;
      /** The tab Settings was opened from, so its page can be asked how checking went. */
      tabId: number | null;
      webAssemblyAvailable: boolean;
    }>
  | Readonly<{ type: 'error:report'; message: string }>
  | Readonly<{ type: 'typing-stats:add'; delta: TypingStatsDelta }>
  | Readonly<{ type: 'data:clear' }>;

export type RuntimeResponse =
  | Readonly<{ ok: true; settings: TypeCheckSettings }>
  | Readonly<{ ok: true; diagnostics: Diagnostics }>
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: string }>;

export function isRuntimeResponse(value: unknown): value is RuntimeResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.ok === false) return typeof record.error === 'string';
  if (record.ok !== true) return false;
  const hasSettings = 'settings' in record;
  const hasDiagnostics = 'diagnostics' in record;
  if (hasSettings && hasDiagnostics) return false;
  if (hasSettings && !isTypeCheckSettings(record.settings)) return false;
  if (hasDiagnostics && !isDiagnostics(record.diagnostics)) return false;
  return true;
}

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record.type === 'settings:get' ||
    record.type === 'data:clear'
  ) {
    return true;
  }
  if (record.type === 'diagnostics:get') {
    return (
      (record.hostname === null || isSafeHostname(record.hostname)) &&
      (record.tabId === null || (Number.isInteger(record.tabId) && (record.tabId as number) >= 0)) &&
      typeof record.webAssemblyAvailable === 'boolean'
    );
  }
  if (record.type === 'error:report') {
    return typeof record.message === 'string' && record.message.length <= MAX_ERROR_REPORT_LENGTH;
  }
  if (record.type === 'settings:replace') return isTypeCheckSettings(record.settings);
  if (record.type === 'typing-stats:add') return isTypingStatsDelta(record.delta);
  if (record.type === 'settings:update') {
    const patch = record.patch;
    const base = record.base;
    if (!isSettingsPatch(patch) || (base !== undefined && !isSettingsConflictBase(base))) return false;
    return base === undefined || Object.keys(base).every((field) => field in patch);
  }
  return (
    record.type === 'site:set-enabled' &&
    isSafeHostname(record.hostname) &&
    typeof record.enabled === 'boolean'
  );
}
