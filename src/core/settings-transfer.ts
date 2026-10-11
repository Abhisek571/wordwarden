import { MAX_DICTIONARY_IMPORT_BYTES, parseDictionaryImport } from './dictionary-transfer';
import { parseSettings, type TypeCheckSettings } from './settings';

const SETTINGS_FILE_FORMAT = 'wordwarden-settings';
const SETTINGS_FILE_VERSION = 1;

/** What an import would change, shown to the user before anything is saved. */
export type SettingsImportPreview = Readonly<{ settings: TypeCheckSettings; summary: string }>;

export function exportSettings(settings: TypeCheckSettings): string {
  return JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: SETTINGS_FILE_VERSION, settings }, null, 2) + '\n';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Reads a settings file from Export, or a plain word list (one word per line) to merge into the dictionary. */
export function parseSettingsImport(text: string, current: TypeCheckSettings): SettingsImportPreview {
  if (!text.trimStart().startsWith('{')) {
    const preview = parseDictionaryImport(text, current.dictionary);
    return Object.freeze({
      settings: Object.freeze({ ...current, dictionary: preview.words }),
      summary: `Merge ${plural(preview.addedCount, 'new word')} with the current dictionary?`,
    });
  }
  if (new TextEncoder().encode(text).byteLength > MAX_DICTIONARY_IMPORT_BYTES) {
    throw new Error('Settings file is too large.');
  }
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('This is not a Wordwarden settings file.');
  }
  const record = typeof file === 'object' && file !== null ? file as Record<string, unknown> : {};
  if (record.format !== SETTINGS_FILE_FORMAT || typeof record.settings !== 'object' || record.settings === null) {
    throw new Error('This is not a Wordwarden settings file.');
  }
  if (typeof record.version === 'number' && record.version > SETTINGS_FILE_VERSION) {
    throw new Error('This settings file is from a newer Wordwarden. Update Wordwarden first.');
  }
  if (record.version !== SETTINGS_FILE_VERSION) throw new Error('This is not a Wordwarden settings file.');
  const settings = parseSettings(record.settings);
  return Object.freeze({
    settings,
    summary: `Replace your current settings with this file? It has ${plural(settings.dictionary.length, 'dictionary word')} ` +
      `and ${plural(settings.disabledSites.length, 'turned-off website')}.`,
  });
}
