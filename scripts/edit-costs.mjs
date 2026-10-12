// Learns how likely each spelling slip is from real misspellings and writes the table to
// src/engines/edit-costs.ts. A misspelling is lined up with its correct word (one letter changed, left
// out, added, or two neighbours swapped) and each slip is counted against how often the letter occurs in
// correct words, so "a" for "e" comes out cheap and "z" for "a" dear.
// Usage: node scripts/edit-costs.mjs <benchmark folder>
// The folder holds birkbeck/missp.dat, birkbeck/wikipedia.dat and lexnorm/{train,dev}.norm (see
// docs/BENCHMARKS.md). Only the tune halves are read, split the same way as the benchmarks, so the holdout
// halves stay unseen.
// Generated with: node scripts/edit-costs.mjs E:\CODING\Wordwarden\benchmarks
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
// Weights are 10 × log2(rate / typical rate), clipped so one rare slip cannot outweigh everything else.
const WEIGHT_LIMIT = 30;
const SMOOTHING = 0.5;

const [benchmarkDir] = process.argv.slice(2);
if (benchmarkDir === undefined) {
  console.error('Usage: node scripts/edit-costs.mjs <benchmark folder>');
  process.exit(1);
}

// The same stable split as tests/benchmark-evaluation.test.ts (`splitFor`): even hashes are tune.
function isTune(key) {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % 2 === 0;
}

function letterDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** Mitton's lists: "$target" lines, each followed by its misspellings; tune half only. */
function readMisspellingList(path) {
  const pairs = [];
  const seen = new Set();
  let target = null;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('$')) {
      target = line.slice(1);
      continue;
    }
    if (target === null || line.includes('_') || target.includes('_')) continue;
    if (!/^[\p{L}'-]+$/u.test(line) || !/^[\p{L}'-]+$/u.test(target)) continue;
    if (line.toLocaleLowerCase('en') === target.toLocaleLowerCase('en')) continue;
    const key = `${line}\u0000${target}`;
    if (seen.has(key) || !isTune(line)) continue;
    seen.add(key);
    pairs.push([line, target]);
  }
  return pairs;
}

/** LexNorm tweets: "raw<TAB>normalised" per token; only one-word fixes within two letters, as scored. */
function readLexnorm(path) {
  const pairs = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const [raw = '', normalised = ''] = line.split('\t');
    const word = /^[a-z']{3,}$/u;
    if (raw === normalised || raw.startsWith('nigg') || !word.test(raw) || !word.test(normalised)) continue;
    if (letterDistance(raw, normalised) <= 2) pairs.push([raw, normalised]);
  }
  return pairs;
}

/**
 * The cheapest edit script from the misspelling to the correct word (optimal string alignment), as a list
 * of [kind, letter, otherLetter] steps: sub (misspelt letter, right letter), ins (letter typed that does
 * not belong), del (letter left out, whether it was one of a doubled pair), swap (the two letters).
 */
function alignment(wrong, right) {
  const rows = wrong.length + 1;
  const columns = right.length + 1;
  const cost = Array.from({ length: rows }, () => new Array(columns).fill(0));
  for (let row = 0; row < rows; row += 1) cost[row][0] = row;
  for (let column = 0; column < columns; column += 1) cost[0][column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      let best = Math.min(
        cost[row - 1][column] + 1,
        cost[row][column - 1] + 1,
        cost[row - 1][column - 1] + (wrong[row - 1] === right[column - 1] ? 0 : 1),
      );
      if (row > 1 && column > 1 && wrong[row - 1] === right[column - 2] && wrong[row - 2] === right[column - 1]) {
        best = Math.min(best, cost[row - 2][column - 2] + 1);
      }
      cost[row][column] = best;
    }
  }
  const steps = [];
  let row = wrong.length;
  let column = right.length;
  while (row > 0 || column > 0) {
    const here = cost[row][column];
    if (row > 1 && column > 1 && wrong[row - 1] === right[column - 2] && wrong[row - 2] === right[column - 1] &&
      wrong[row - 1] !== wrong[row - 2] && here === cost[row - 2][column - 2] + 1) {
      steps.push(['swap', right[column - 2], right[column - 1]]);
      row -= 2;
      column -= 2;
    } else if (row > 0 && column > 0 && wrong[row - 1] === right[column - 1] && here === cost[row - 1][column - 1]) {
      row -= 1;
      column -= 1;
    } else if (row > 0 && column > 0 && here === cost[row - 1][column - 1] + 1) {
      steps.push(['sub', wrong[row - 1], right[column - 1]]);
      row -= 1;
      column -= 1;
    } else if (column > 0 && here === cost[row][column - 1] + 1) {
      steps.push(['del', right[column - 1], right[column - 2] === right[column - 1] || right[column] === right[column - 1]]);
      column -= 1;
    } else {
      steps.push(['ins', wrong[row - 1], '']);
      row -= 1;
    }
  }
  return steps;
}

const files = [
  ['birkbeck/missp.dat', readMisspellingList],
  ['birkbeck/wikipedia.dat', readMisspellingList],
  ['lexnorm/train.norm', readLexnorm],
  ['lexnorm/dev.norm', readLexnorm],
];
const pairs = [];
for (const [file, read] of files) {
  const path = join(benchmarkDir, file);
  if (!existsSync(path)) {
    console.error(`missing ${path}`);
    process.exit(1);
  }
  pairs.push(...read(path));
}

const letterCounts = new Map([...LETTERS].map((letter) => [letter, 0]));
const substitutions = new Map([...LETTERS].map((letter) => [letter, new Map([...LETTERS].map((other) => [other, 0]))]));
const deletions = new Map([...LETTERS].map((letter) => [letter, 0]));
const doubleDrops = new Map([...LETTERS].map((letter) => [letter, 0]));
const insertions = new Map([...LETTERS].map((letter) => [letter, 0]));
const swaps = new Map([...LETTERS].map((letter) => [letter, 0]));
let used = 0;
for (const [wrongRaw, rightRaw] of pairs) {
  const wrong = wrongRaw.toLocaleLowerCase('en');
  const right = rightRaw.toLocaleLowerCase('en');
  if (!/^[a-z]+$/u.test(wrong) || !/^[a-z]+$/u.test(right) || wrong === right) continue;
  used += 1;
  for (const letter of right) letterCounts.set(letter, letterCounts.get(letter) + 1);
  for (const [kind, letter, other] of alignment(wrong, right)) {
    if (kind === 'sub') substitutions.get(letter).set(other, substitutions.get(letter).get(other) + 1);
    else if (kind === 'ins') insertions.set(letter, insertions.get(letter) + 1);
    else if (kind === 'swap') swaps.set(letter, swaps.get(letter) + 1);
    else if (other) doubleDrops.set(letter, doubleDrops.get(letter) + 1);
    else deletions.set(letter, deletions.get(letter) + 1);
  }
}

const totalLetters = [...letterCounts.values()].reduce((sum, count) => sum + count, 0);

function weight(count, base, typicalRate) {
  const rate = (count + SMOOTHING) / (base + SMOOTHING / typicalRate);
  return Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, Math.round(10 * Math.log2(rate / typicalRate))));
}

function perLetterTable(counts) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const typical = total / totalLetters;
  return [...LETTERS].map((letter) => weight(counts.get(letter), letterCounts.get(letter), typical));
}

const totalSubstitutions = [...substitutions.values()].reduce(
  (sum, row) => sum + [...row.values()].reduce((rowSum, count) => rowSum + count, 0), 0,
);
const typicalSubstitution = totalSubstitutions / totalLetters / (LETTERS.length - 1);
// Rows are the letter typed, columns the letter meant.
const substitutionTable = [...LETTERS].map((typed) => [...LETTERS].map((meant) => (
  typed === meant ? 0 : weight(substitutions.get(meant).get(typed), letterCounts.get(meant), typicalSubstitution)
)));
const insertionTotal = [...insertions.values()].reduce((sum, count) => sum + count, 0);
const insertionTable = [...LETTERS].map((letter) => weight(
  insertions.get(letter), totalLetters, insertionTotal / totalLetters / LETTERS.length,
));

const rows = (table) => table.map((row) => `  [${row.join(', ')}],`).join('\n');
const list = (table) => `[${table.join(', ')}]`;
const output = `// Generated by scripts/edit-costs.mjs from the tune halves of the Birkbeck, Wikipedia and LexNorm
// misspelling lists (${used.toLocaleString('en')} misspellings); do not edit by hand.
// Each weight is 10 × log2 of how likely the slip is compared with a typical slip of its kind, from -${WEIGHT_LIMIT}
// (rare) to ${WEIGHT_LIMIT} (common). Letters are indexed a–z.

/** SUBSTITUTION[typed][meant]: the letter typed instead of the one meant. */
export const SUBSTITUTION: readonly (readonly number[])[] = [
${rows(substitutionTable)}
];

/** A letter added that does not belong. */
export const INSERTION: readonly number[] = ${list(insertionTable)};

/** A letter left out (not one of a doubled pair). */
export const DELETION: readonly number[] = ${list(perLetterTable(deletions))};

/** One of a doubled pair left out ("leter" for "letter"). */
export const DOUBLE_DROP: readonly number[] = ${list(perLetterTable(doubleDrops))};

/** Two neighbouring letters swapped, by the first letter of the right order. */
export const SWAP: readonly number[] = ${list(perLetterTable(swaps))};
`;
const outputPath = 'src/engines/edit-costs.ts';
writeFileSync(outputPath, output);

const ranked = [];
for (const [typedIndex, typed] of [...LETTERS].entries()) {
  for (const [meantIndex, meant] of [...LETTERS].entries()) {
    if (typed !== meant) ranked.push([`${typed} for ${meant}`, substitutionTable[typedIndex][meantIndex]]);
  }
}
ranked.sort((a, b) => b[1] - a[1]);
console.log(`${outputPath}: ${used.toLocaleString('en')} misspellings, ${Buffer.byteLength(output)} bytes`);
console.log(`cheapest substitutions: ${ranked.slice(0, 12).map(([name, w]) => `${name} (${w})`).join(', ')}`);
console.log(`dearest substitutions: ${ranked.slice(-8).map(([name, w]) => `${name} (${w})`).join(', ')}`);
const show = (label, table) => console.log(`${label}: ${[...LETTERS].map((letter, index) => `${letter}${table[index]}`).join(' ')}`);
show('insertion', insertionTable);
show('deletion', perLetterTable(deletions));
show('double drop', perLetterTable(doubleDrops));
show('swap', perLetterTable(swaps));
