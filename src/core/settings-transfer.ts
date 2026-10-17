import { MAX_DICTIONARY_IMPORT_BYTES, parseDictionaryImport } from './dictionary-transfer';
import { parseSettings, type TypeCheckSettings } from './settings';

const SETTINGS_FILE_FORMAT = 'wordwarden-settings';
const SETTINGS_FILE_VERSION = 1;

/**
 * What an import would change, shown to the user before anything is saved. A word list carries only its words
 * (`addWords`), which are added to the settings as they are when the import is confirmed, so changes made while the
 * preview was open are kept.
 */
export type SettingsImportPreview = Readonly<{ settings: TypeCheckSettings; summary: string; addWords?: readonly string[] }>;

/** The dictionary with the imported words added, in the order the import keeps. */
export function withImportedWords(current: TypeCheckSettings, words: readonly string[]): TypeCheckSettings {
  return Object.freeze({ ...current, dictionary: parseDictionaryImport(words.join('\n'), current.dictionary).words });
}

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
      addWords: Object.freeze(text.split(/\r?\n/u).map((word) => word.trim()).filter(Boolean)),
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
  // An empty object would quietly reset every setting to its default.
  if (Array.isArray(record.settings) || Object.keys(record.settings).length === 0) {
    throw new Error('This settings file has no settings in it.');
  }
  const settings = parseSettings(record.settings);
  const fileWords = (record.settings as Record<string, unknown>).dictionary;
  const dropped = Array.isArray(fileWords) ? fileWords.length - settings.dictionary.length : 0;
  return Object.freeze({
    settings,
    summary: `Replace your current settings with this file? It has ${plural(settings.dictionary.length, 'dictionary word')} ` +
      `and ${plural(settings.disabledSites.length, 'turned-off website')}.` +
      (dropped > 0 ? ` ${plural(dropped, 'word')} over the 10,000-word limit or the 80-character limit will be left out.` : ''),
  });
}
