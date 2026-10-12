import nspell from 'nspell';
import { browser } from 'wxt/browser';
import type { EnglishDialect, IssueCategory } from '#/core/types';
import { isPopularVocabularyWord } from '#/core/popular-vocabulary';
import { DELETION, DOUBLE_DROP, INSERTION, SUBSTITUTION, SWAP } from '#/engines/edit-costs';
import { phoneticKey } from '#/engines/phonetic-key';
import { EMPTY_WORD_PAIRS, parseWordPairs, type WordPairs } from '#/engines/word-pairs';

/** The words either side of a misspelling, lower-cased, when only spaces separate them from it. */
export type WordContext = Readonly<{
  previous?: string;
  next?: string;
}>;

export type SpellingRanker = Readonly<{
  rank(token: string, harperCandidates: readonly string[], context?: WordContext): readonly string[];
  hasPrefixCompletion(token: string): boolean;
  wordPairs: WordPairs;
}>;

export function rankIssueReplacements(
  category: IssueCategory,
  token: string,
  harperCandidates: readonly string[],
  spellingRanker: SpellingRanker,
  context: WordContext = Object.freeze({}),
): readonly string[] {
  if (category === 'spelling') return spellingRanker.rank(token, harperCandidates, context);
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
  soundGroups: ReadonlyMap<string, readonly string[]>;
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
  // Words that sound alike, most common first, so "becos" can find "because" three edits away.
  const soundGroups = new Map<string, string[]>();
  for (const [word] of [...counts].sort((left, right) => right[1] - left[1])) {
    const key = phoneticKey(word);
    if (key.length === 0) continue;
    const group = soundGroups.get(key);
    if (group === undefined) soundGroups.set(key, [word]);
    else group.push(word);
  }
  return Object.freeze({
    counts,
    displayWords,
    sortedWords: Object.freeze([...counts.keys()].sort()),
    soundGroups,
  });
}

const SOUND_CANDIDATE_LIMIT = 20;

// How far a word that sounds right may be in spelling: "nite" is three edits from "night".
function soundEditLimit(token: string): number {
  return token.length <= 3 ? 1 : 3;
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

// "nite" and "night" share a first vowel; "not" does not, so it was not spelt by ear.
function firstVowel(word: string): string {
  return /[aeiouy]/u.exec(word)?.[0] ?? '';
}

// "-ing", "-ed" and "-ly" are heard; a final "s" may just be how "becos" was spelt.
function spokenEnding(word: string): string | null {
  const ending = inflectionEnding(word);
  return ending === 's' || ending === 'es' ? null : ending;
}

// Spelling by ear drops letters ("nite"), so the word meant is rarely shorter than the misspelling,
// and it keeps the grammatical ending: "alcoholical" is "alcoholic", not "alcoholically".
function soundsLike(token: string, tokenKey: string, candidate: string): boolean {
  return candidate.length >= token.length &&
    phoneticKey(candidate) === tokenKey &&
    firstVowel(candidate) === firstVowel(token) &&
    spokenEnding(candidate) === spokenEnding(token);
}

const LETTER_A = 'a'.charCodeAt(0);

function letterIndex(letter: string | undefined): number {
  return letter === undefined ? -1 : letter.charCodeAt(0) - LETTER_A;
}

// The learned weight (10 × log2 of how likely, against a typical slip of its kind) of the slips that
// turn the candidate into the token, lined up as in the edit distance above; 0 when either has a
// character that is not a plain letter, so nothing is read for it.
function slipWeight(token: string, candidate: string): number {
  if (!/^[a-z]+$/u.test(token) || !/^[a-z]+$/u.test(candidate)) return 0;
  const rows = token.length + 1;
  const columns = candidate.length + 1;
  const cost: number[][] = Array.from({ length: rows }, (_, row) => {
    const line = new Array<number>(columns).fill(0);
    line[0] = row;
    return line;
  });
  for (let column = 0; column < columns; column += 1) (cost[0] ?? [])[column] = column;
  const at = (row: number, column: number): number => cost[row]?.[column] ?? 0;
  const swapped = (row: number, column: number): boolean => row > 1 && column > 1 &&
    token[row - 1] === candidate[column - 2] && token[row - 2] === candidate[column - 1] &&
    token[row - 1] !== token[row - 2];
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      let best = Math.min(
        at(row - 1, column) + 1,
        at(row, column - 1) + 1,
        at(row - 1, column - 1) + (token[row - 1] === candidate[column - 1] ? 0 : 1),
      );
      if (swapped(row, column)) best = Math.min(best, at(row - 2, column - 2) + 1);
      (cost[row] ?? [])[column] = best;
    }
  }
  let weight = 0;
  let row = token.length;
  let column = candidate.length;
  while (row > 0 || column > 0) {
    const here = at(row, column);
    if (swapped(row, column) && here === at(row - 2, column - 2) + 1) {
      weight += SWAP[letterIndex(candidate[column - 2])] ?? 0;
      row -= 2;
      column -= 2;
    } else if (row > 0 && column > 0 && token[row - 1] === candidate[column - 1] && here === at(row - 1, column - 1)) {
      row -= 1;
      column -= 1;
    } else if (row > 0 && column > 0 && here === at(row - 1, column - 1) + 1) {
      weight += SUBSTITUTION[letterIndex(token[row - 1])]?.[letterIndex(candidate[column - 1])] ?? 0;
      row -= 1;
      column -= 1;
    } else if (column > 0 && here === at(row, column - 1) + 1) {
      const letter = candidate[column - 1];
      const doubled = candidate[column - 2] === letter || candidate[column] === letter;
      weight += (doubled ? DOUBLE_DROP : DELETION)[letterIndex(letter)] ?? 0;
      column -= 1;
    } else {
      weight += INSERTION[letterIndex(token[row - 1])] ?? 0;
      row -= 1;
    }
  }
  return weight;
}

const CONTEXT_FLOOR = 0.01;
const CONTEXT_CEILING = 100;

// How much of a word's use in news text is next to this neighbour: "of the" is 238,000 of the 2.35M uses
// of "the", so "the" after "of" is ×10, while "from" hardly ever follows "the", so it is ×0.01 (the floor).
// A word the pair data does not know gets ×1: there is no evidence either way.
function neighbourFit(pairs: WordPairs, word: string, pairCount: number): number {
  const total = pairs.wordCount(word);
  if (total === 0) return 1;
  return Math.min(CONTEXT_CEILING, Math.max(CONTEXT_FLOOR, (100 * (pairCount + 1)) / (total + 100)));
}

function contextFit(pairs: WordPairs, word: string, context: WordContext): number {
  const before = context.previous === undefined ? 1 : neighbourFit(pairs, word, pairs.pairCount(context.previous, word));
  const after = context.next === undefined ? 1 : neighbourFit(pairs, word, pairs.pairCount(word, context.next));
  return before * after;
}

type Support = Readonly<{
  commonTypo: boolean;
  keySlip: boolean;
  endingMatch: boolean;
  byEar: boolean;
  frequency: number;
  slip: number;
  context: number;
}>;

// How well a candidate the same distance away fits the misspelling: a left-out or swapped letter is
// worth a hundredfold in frequency ("workd" is "worked", not "world"), a slipped finger or a kept ending
// tenfold, and a word that sounds right twofold ("nite" is "night", not "unite" or "nice"). A word
// missing from the frequency list still outranks one that is merely frequent when its shape fits better.
// On top of that, the particular letters slipped count ("e" for "a" is common, "z" for "a" is not), and
// so do the words either side ("the form of", not "the from of").
function support(item: Support): number {
  return (item.frequency + (item.commonTypo ? 1 : 0) + (item.endingMatch ? 0.5 : 0)) *
    (item.commonTypo ? 100 : 1) * (item.keySlip ? 10 : 1) * (item.endingMatch ? 10 : 1) * (item.byEar ? 2 : 1) *
    2 ** (item.slip / 10) * item.context;
}

export function createSpellingRankerFromData(
  dictionary: DictionaryText,
  entries: readonly FrequencyEntry[],
  personalWords: readonly string[],
  wordPairs: WordPairs = EMPTY_WORD_PAIRS,
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

  function rank(
    token: string,
    harperCandidates: readonly string[],
    context: WordContext = Object.freeze({}),
  ): readonly string[] {
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
    // Words spelt by ear ("fone", "becos") are often too far from the right word for the edits above.
    // Only plain letters can be read aloud: "don;t" sounds nothing like "donate".
    const spokenToken = /^[a-z]+$/u.test(normalizedToken);
    const tokenKey = phoneticKey(normalizedToken);
    const soundLimit = soundEditLimit(normalizedToken);
    const soundCandidates = (spokenToken ? frequencies.soundGroups.get(tokenKey) ?? [] : [])
      .slice(0, SOUND_CANDIDATE_LIMIT)
      .filter((word) => (
        soundsLike(normalizedToken, tokenKey, word) &&
        editDistance(normalizedToken, word) <= soundLimit &&
        checker.correct(word)
      ));
    const candidates = [
      ...(irregularPast === undefined ? [] : [irregularPast]),
      ...nearPersonal,
      ...prefixCandidates,
      ...checker.suggest(normalizedToken),
      ...harperCandidates,
      ...editCandidates.map((edit) => frequencies.displayWords.get(edit) ?? edit),
      ...soundCandidates.map((word) => frequencies.displayWords.get(word) ?? word),
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
        const distance = editDistance(normalizedToken, normalizedCandidate);
        // Two or more edits that keep the sound ("nite" for "night") were spelt by ear, not mistyped.
        const byEar = spokenToken && distance >= 2 && soundsLike(normalizedToken, tokenKey, normalizedCandidate);
        const fit = Object.freeze({
          commonTypo: isCommonTypoOf(normalizedToken, normalizedCandidate),
          keySlip: isNeighbourKeySlip(normalizedToken, normalizedCandidate),
          endingMatch: ending !== null && normalizedCandidate.endsWith(ending),
          byEar,
          frequency: frequencies.counts.get(normalizedCandidate) ?? 0,
          // Which letters slipped only tells mistypings apart; a word spelt by ear is judged by its sound.
          slip: distance <= 2 && !byEar ? slipWeight(normalizedToken, normalizedCandidate) : 0,
          context: contextFit(wordPairs, normalizedCandidate, context),
        });
        return Object.freeze({
          candidate,
          structural: structuralMatch(normalizedToken, normalizedCandidate),
          distance,
          // A word spelt by ear counts as one typo away, however far off the letters are.
          rankDistance: byEar ? 1 : distance,
          irregular: normalizedCandidate === irregularPast,
          commonTypo: fit.commonTypo,
          keySlip: fit.keySlip,
          frequency: fit.frequency,
          support: support(fit),
        });
      })
      .sort(
        (left, right) =>
          Number(right.irregular) - Number(left.irregular) ||
          Number(right.structural) - Number(left.structural) ||
          left.rankDistance - right.rankDistance ||
          right.support - left.support ||
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

  return Object.freeze({ rank, hasPrefixCompletion, wordPairs });
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

async function fetchWordPairs(): Promise<WordPairs> {
  const path = 'spelling/pairs.bin';
  const response = await fetch(extensionUrl(path));
  if (!response.ok) {
    throw new Error(
      `Could not load bundled spelling asset ${path}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return parseWordPairs(new Uint8Array(await response.arrayBuffer()));
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
  const [aff, dic, entries, wordPairs] = await Promise.all([
    fetchText(`spelling/${stem}.aff`),
    fetchText(`spelling/${stem}.dic`),
    fetchFrequencies(),
    fetchWordPairs(),
  ]);
  return createSpellingRankerFromData(Object.freeze({ aff, dic }), entries, personalWords, wordPairs);
}
