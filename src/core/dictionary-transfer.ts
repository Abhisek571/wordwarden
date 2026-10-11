export const MAX_DICTIONARY_IMPORT_BYTES = 1_000_000;
export const MAX_DICTIONARY_WORDS = 10_000;
const MAX_WORD_LENGTH = 80;
const WORD = /^\p{L}[\p{L}\p{M}\p{N}'’-]*$/u;

export type DictionaryImportPreview = Readonly<{ words: readonly string[]; addedCount: number }>;

function compareWords(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function uniqueWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  return words.filter((word) => {
    const key = word.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseDictionaryImport(text: string, existing: readonly string[]): DictionaryImportPreview {
  if (new TextEncoder().encode(text).byteLength > MAX_DICTIONARY_IMPORT_BYTES) {
    throw new Error('Dictionary import is too large.');
  }
  const imported = text.split(/\r?\n/).map((word) => word.trim()).filter(Boolean);
  for (const word of imported) {
    if (word.length > MAX_WORD_LENGTH || !WORD.test(word)) throw new Error(`Invalid dictionary word: ${word}`);
  }
  const before = uniqueWords(existing);
  const words = uniqueWords([...before, ...imported]).sort(compareWords);
  if (words.length > MAX_DICTIONARY_WORDS) throw new Error('Dictionary import has too many words.');
  return Object.freeze({ words: Object.freeze(words), addedCount: words.length - before.length });
}
