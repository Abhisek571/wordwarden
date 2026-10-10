import nspell from 'nspell';
import { browser } from 'wxt/browser';
import type { EnglishDialect, IssueCategory } from '#/core/types';
import { isPopularVocabularyWord } from '#/core/popular-vocabulary';

export type SpellingRanker = Readonly<{
  rank(token: string, harperCandidates: readonly string[]): readonly string[];
  hasPrefixCompletion(token: string): boolean;
}>;

export function rankIssueReplacements(
  category: IssueCategory,
  token: string,
  harperCandidates: readonly string[],
  spellingRanker: SpellingRanker,
): readonly string[] {
  if (category === 'spelling') return spellingRanker.rank(token, harperCandidates);
  return Object.freeze([...harperCandidates]);
}

type FrequencyEntry = Readonly<{
  word: string;
  count: number;
}>;

type DictionaryText = Readonly<{
  aff: string;
  dic: string;
}>;

const DICTIONARY_STEMS: Readonly<Record<EnglishDialect, string>> = Object.freeze({
  american: 'en',
  australian: 'en-au',
  canadian: 'en-ca',
  british: 'en-gb',
});

const INFLECTION_ENDINGS = Object.freeze(['ing', 'ed', 'ly', 'es', 's']);

// Regular "-ed" forms of irregular verbs: "buyed" should suggest "bought", not "buoyed".
const IRREGULAR_PAST_TENSES: ReadonlyMap<string, string> = Object.freeze(
  new Map([
    ['blowed', 'blew'], ['breaked', 'broke'], ['bringed', 'brought'], ['builded', 'built'],
    ['buyed', 'bought'], ['catched', 'caught'], ['choosed', 'chose'], ['comed', 'came'],
    ['digged', 'dug'], ['drawed', 'drew'], ['drinked', 'drank'], ['drived', 'drove'],
    ['eated', 'ate'], ['falled', 'fell'], ['feeled', 'felt'], ['fighted', 'fought'],
    ['finded', 'found'], ['flied', 'flew'], ['forgetted', 'forgot'], ['forgived', 'forgave'],
    ['freezed', 'froze'], ['getted', 'got'], ['gived', 'gave'], ['goed', 'went'],
    ['growed', 'grew'], ['hided', 'hid'], ['hitted', 'hit'], ['holded', 'held'],
    ['hurted', 'hurt'], ['keeped', 'kept'], ['knowed', 'knew'], ['leaved', 'left'],
    ['lended', 'lent'], ['losed', 'lost'], ['maked', 'made'], ['meeted', 'met'],
    ['readed', 'read'], ['rided', 'rode'], ['rised', 'rose'], ['runned', 'ran'],
    ['sayed', 'said'], ['seeked', 'sought'], ['sended', 'sent'], ['shaked', 'shook'],
    ['sitted', 'sat'], ['sleeped', 'slept'], ['speaked', 'spoke'], ['spended', 'spent'],
    ['standed', 'stood'], ['stealed', 'stole'], ['sweared', 'swore'], ['swimmed', 'swam'],
    ['taked', 'took'], ['teached', 'taught'], ['telled', 'told'], ['thinked', 'thought'],
    ['throwed', 'threw'], ['understanded', 'understood'], ['weared', 'wore'],
    ['winned', 'won'], ['writed', 'wrote'],
  ]),
);

function extensionUrl(path: string): string {
  const getUrl = browser.runtime.getURL as (assetPath: string) => string;
  return getUrl(path);
}

function frequencyEntries(value: unknown): readonly FrequencyEntry[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Bundled spelling frequency data must be an array.');
  }
  return Object.freeze(
    value.map((item, index) => {
      if (typeof item !== 'object' || item === null) {
        throw new TypeError(`Spelling frequency entry ${index} must be an object.`);
      }
      const record = item as Record<string, unknown>;
      if (typeof record.word !== 'string' || typeof record.count !== 'number') {
        throw new TypeError(`Spelling frequency entry ${index} is missing word or count.`);
      }
      return Object.freeze({ word: record.word, count: record.count });
    }),
  );
}

function frequencyIndex(entries: readonly FrequencyEntry[]): Readonly<{
  counts: ReadonlyMap<string, number>;
  displayWords: ReadonlyMap<string, string>;
  sortedWords: readonly string[];
}> {
  const counts = new Map<string, number>();
  const displayWords = new Map<string, string>();
  for (const entry of entries) {
    const normalizedWord = entry.word.toLocaleLowerCase('en');
    if (!counts.has(normalizedWord) && entry.word !== normalizedWord) {
      displayWords.set(normalizedWord, entry.word);
    }
    counts.set(normalizedWord, entry.count);
  }
  return Object.freeze({
    counts,
    displayWords,
    sortedWords: Object.freeze([...counts.keys()].sort()),
  });
}

function lowerBound(values: readonly string[], target: string): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((values[middle] ?? '') < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

// Optimal string alignment distance: a swap of two adjacent letters ("teh") is one typo.
function editDistance(source: string, target: string): number {
  let beforePrevious = new Array<number>(target.length + 1).fill(0);
  let previous = Array.from({ length: target.length + 1 }, (_, index) => index);
  let current = new Array<number>(target.length + 1);
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    current[0] = sourceIndex;
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const substitutionCost = source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
      let distance = Math.min(
        (current[targetIndex - 1] ?? 0) + 1,
        (previous[targetIndex] ?? 0) + 1,
        (previous[targetIndex - 1] ?? 0) + substitutionCost,
      );
      if (
        sourceIndex > 1 &&
        targetIndex > 1 &&
        source[sourceIndex - 1] === target[targetIndex - 2] &&
        source[sourceIndex - 2] === target[targetIndex - 1]
      ) {
        distance = Math.min(distance, (beforePrevious[targetIndex - 2] ?? 0) + 1);
      }
      current[targetIndex] = distance;
    }
    const completedRow = beforePrevious;
    beforePrevious = previous;
    previous = current;
    current = completedRow;
  }
  return previous[target.length] ?? target.length;
}

const EDIT_ALPHABET = "abcdefghijklmnopqrstuvwxyz'";
const MAX_EDIT_CANDIDATE_LENGTH = 20;

// Every string one deletion, swap, replacement, or insertion away from the token.
function singleEdits(token: string): readonly string[] {
  if (token.length > MAX_EDIT_CANDIDATE_LENGTH) return Object.freeze([]);
  const edits: string[] = [];
  for (let index = 0; index <= token.length; index += 1) {
    const head = token.slice(0, index);
    const tail = token.slice(index);
    if (tail.length > 0) edits.push(head + tail.slice(1));
    if (tail.length > 1) edits.push(head + tail[1] + tail[0] + tail.slice(2));
    for (const letter of EDIT_ALPHABET) {
      if (tail.length > 0) edits.push(head + letter + tail.slice(1));
      edits.push(head + letter + tail);
    }
  }
  return Object.freeze(edits);
}

// Left-out letters ("workd" for "worked") and swapped letters ("teh") are the most common typos.
function isCommonTypoOf(token: string, candidate: string): boolean {
  if (candidate.length === token.length + 1) {
    for (let index = 0; index < candidate.length; index += 1) {
      if (candidate.slice(0, index) + candidate.slice(index + 1) === token) return true;
    }
    return false;
  }
  if (candidate.length !== token.length) return false;
  for (let index = 0; index < token.length - 1; index += 1) {
    if (
      token[index] === candidate[index + 1] &&
      token[index + 1] === candidate[index] &&
      token.slice(0, index) === candidate.slice(0, index) &&
      token.slice(index + 2) === candidate.slice(index + 2)
    ) {
      return true;
    }
  }
  return false;
}

// Neighbouring keys on a QWERTY keyboard: "uo" for "up" is one slipped finger.
const KEYBOARD_ROWS = Object.freeze(['qwertyuiop', 'asdfghjkl', 'zxcvbnm']);

// Each row sits about half a key to the right of the one above it.
function keyPosition(letter: string): Readonly<{ row: number; x: number }> | null {
  const row = KEYBOARD_ROWS.findIndex((keys) => keys.includes(letter));
  const column = KEYBOARD_ROWS[row]?.indexOf(letter) ?? -1;
  return row < 0 ? null : Object.freeze({ row, x: column + row * 0.5 });
}

function areNeighbourKeys(left: string, right: string): boolean {
  const a = keyPosition(left);
  const b = keyPosition(right);
  return a !== null && b !== null && left !== right &&
    Math.abs(a.row - b.row) <= 1 && Math.abs(a.x - b.x) <= 1;
}

function isNeighbourKeySlip(token: string, candidate: string): boolean {
  if (token.length !== candidate.length) return false;
  const differences = [...token].flatMap((letter, index) => (letter === candidate[index] ? [] : [index]));
  const [index] = differences;
  return differences.length === 1 && index !== undefined &&
    areNeighbourKeys(token[index] ?? '', candidate[index] ?? '');
}

function isShortFragment(token: string, candidate: string): boolean {
  return token === token.toLocaleLowerCase('en') &&
    candidate.length <= 2 &&
    candidate !== candidate.toLocaleLowerCase('en');
}

function inflectionEnding(word: string): string | null {
  return (
    INFLECTION_ENDINGS.find(
      (ending) => word.length > ending.length + 1 && word.endsWith(ending),
    ) ?? null
  );
}

function preserveCase(token: string, replacement: string): string {
  if (isPopularVocabularyWord(replacement)) return replacement;
  if (token === token.toLocaleUpperCase('en')) return replacement.toLocaleUpperCase('en');
  const first = token[0];
  if (
    first !== undefined &&
    first === first.toLocaleUpperCase('en') &&
    token.slice(1) === token.slice(1).toLocaleLowerCase('en')
  ) {
    return `${replacement.slice(0, 1).toLocaleUpperCase('en')}${replacement.slice(1)}`;
  }
  return replacement;
}

function structuralMatch(token: string, replacement: string): boolean {
  return replacement.replace(/[\s'-]/gu, '') === token.replace(/[\s'-]/gu, '');
}

export function createSpellingRankerFromData(
  dictionary: DictionaryText,
  entries: readonly FrequencyEntry[],
  personalWords: readonly string[],
): SpellingRanker {
  const checker = nspell(dictionary.aff, dictionary.dic);
  const personalCandidates = Object.freeze([...personalWords]);
  const personalCompletionPrefixes = new Set<string>();
  for (const word of personalWords) {
    const normalizedWord = word.toLocaleLowerCase('en');
    // Bundled brands must not make ordinary words such as “space” look unfinished.
    if (!isPopularVocabularyWord(word)) {
      for (let length = 2; length < normalizedWord.length; length += 1) {
        personalCompletionPrefixes.add(normalizedWord.slice(0, length));
      }
    }
    checker.add(word);
    checker.add(normalizedWord);
  }
  const frequencies = frequencyIndex(entries);

  function rank(token: string, harperCandidates: readonly string[]): readonly string[] {
    const normalizedToken = token.toLocaleLowerCase('en');
    const ending = inflectionEnding(normalizedToken);
    const prefixCandidates: string[] = [];
    for (
      let index = lowerBound(frequencies.sortedWords, normalizedToken);
      index < frequencies.sortedWords.length;
      index += 1
    ) {
      const normalizedWord = frequencies.sortedWords[index];
      if (normalizedWord === undefined || !normalizedWord.startsWith(normalizedToken)) break;
      prefixCandidates.push(frequencies.displayWords.get(normalizedWord) ?? normalizedWord);
    }
    const editCandidates = singleEdits(normalizedToken).filter(
      (edit) => frequencies.counts.has(edit) && checker.correct(edit),
    );
    const irregularPast = IRREGULAR_PAST_TENSES.get(normalizedToken);
    // Personal and bundled words are offered only for near misses, never for unrelated typos.
    const personalLimit = normalizedToken.length <= 4 ? 1 : 2;
    const nearPersonal = personalCandidates.filter(
      (word) => editDistance(normalizedToken, word.toLocaleLowerCase('en')) <= personalLimit,
    );
    const candidates = [
      ...(irregularPast === undefined ? [] : [irregularPast]),
      ...nearPersonal,
      ...prefixCandidates,
      ...checker.suggest(normalizedToken),
      ...harperCandidates,
      ...editCandidates.map((edit) => frequencies.displayWords.get(edit) ?? edit),
    ];
    const unique = new Map<string, string>();
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (trimmed.length === 0) continue;
      const key = trimmed.toLocaleLowerCase('en');
      if (key === normalizedToken || unique.has(key) || isShortFragment(token, trimmed)) continue;
      unique.set(key, trimmed);
    }

    const ranked = [...unique.values()]
      .map((candidate) => {
        const normalizedCandidate = candidate.toLocaleLowerCase('en');
        return Object.freeze({
          candidate,
          structural: structuralMatch(normalizedToken, normalizedCandidate),
          distance: editDistance(normalizedToken, normalizedCandidate),
          irregular: normalizedCandidate === irregularPast,
          commonTypo: isCommonTypoOf(normalizedToken, normalizedCandidate),
          keySlip: isNeighbourKeySlip(normalizedToken, normalizedCandidate),
          endingMatch: ending !== null && normalizedCandidate.endsWith(ending),
          frequency: frequencies.counts.get(normalizedCandidate) ?? 0,
        });
      })
      .sort(
        (left, right) =>
          Number(right.irregular) - Number(left.irregular) ||
          Number(right.structural) - Number(left.structural) ||
          left.distance - right.distance ||
          Number(right.commonTypo) - Number(left.commonTypo) ||
          Number(right.endingMatch) - Number(left.endingMatch) ||
          right.frequency - left.frequency ||
          left.candidate.localeCompare(right.candidate, 'en'),
      );
    const shown = ranked.slice(0, 3);
    // "uo" ranks "ufo" first; keep the far more common "up" (one key over) on the card in the last spot.
    const best = shown[0];
    const mostCommon = best === undefined ? undefined : ranked
      .filter((item) => item.distance === best.distance && item.frequency > 0 && (item.commonTypo || item.keySlip))
      .reduce<(typeof ranked)[number] | undefined>(
        (top, item) => (top === undefined || item.frequency > top.frequency ? item : top),
        undefined,
      );
    if (mostCommon !== undefined && shown.length === 3 && !shown.includes(mostCommon)) {
      shown[2] = mostCommon;
    }
    return Object.freeze(shown.map((item) => preserveCase(token, item.candidate)));
  }

  function hasPrefixCompletion(token: string): boolean {
    const normalizedToken = token.toLocaleLowerCase('en');
    if (normalizedToken.length < 2) return false;
    if (personalCompletionPrefixes.has(normalizedToken)) return true;
    const index = lowerBound(frequencies.sortedWords, normalizedToken);
    const first = frequencies.sortedWords[index];
    const tokenCount = first === normalizedToken ? frequencies.counts.get(normalizedToken) ?? 0 : 0;
    // A finished common word ("tomorrow") is not an unfinished rare one ("tomorrows").
    let completionCount = -1;
    for (let offset = first === normalizedToken ? 1 : 0; offset <= 50; offset += 1) {
      const candidate = frequencies.sortedWords[index + offset];
      if (candidate === undefined || !candidate.startsWith(normalizedToken)) break;
      completionCount = Math.max(completionCount, frequencies.counts.get(candidate) ?? 0);
    }
    return completionCount >= 0 && (tokenCount === 0 || completionCount * 10 >= tokenCount);
  }

  return Object.freeze({ rank, hasPrefixCompletion });
}

async function fetchText(path: string): Promise<string> {
  const url = extensionUrl(path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not load bundled spelling asset ${path}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

async function fetchFrequencies(): Promise<readonly FrequencyEntry[]> {
  const path = 'spelling/frequencies.json';
  const url = extensionUrl(path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not load bundled spelling asset ${path}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return frequencyEntries(await response.json());
}

export async function createSpellingRanker(
  dialect: EnglishDialect,
  personalWords: readonly string[],
): Promise<SpellingRanker> {
  const stem = DICTIONARY_STEMS[dialect];
  const [aff, dic, entries] = await Promise.all([
    fetchText(`spelling/${stem}.aff`),
    fetchText(`spelling/${stem}.dic`),
    fetchFrequencies(),
  ]);
  return createSpellingRankerFromData(Object.freeze({ aff, dic }), entries, personalWords);
}
