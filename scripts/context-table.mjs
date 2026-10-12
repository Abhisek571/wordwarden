// Packs word-pair counts into public/spelling/pairs.bin, the context the spelling ranker and the
// confused-word rule use ("the form of" is common, "the from of" is not).
// Usage: node scripts/context-table.mjs <corpora folder>
// The folder holds bigrams/pairs.tsv (word1<TAB>word2<TAB>count) and bigrams/unigrams.tsv (word<TAB>count)
// from 2M Leipzig news sentences (see THIRD_PARTY_NOTICES.md). Only pairs of words the ranker can offer
// (the frequency list, the Hunspell dictionaries, or the extra word lists) are kept. The corpora stay out
// of the repo.
// Generated with: node scripts/context-table.mjs E:\CODING\Wordwarden\corpora
//
// Layout (little-endian): "WWP1", u32 vocabulary byte length, the vocabulary as newline-separated words
// (ids are their positions), one count byte per word, u32 pair count, u32 row count, then per row: varint
// first-word id delta, varint pair count, and per pair varint second-word id delta and one count byte.
// A count byte is round(10 × log2(count)).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A pair must occur this often in the 2M sentences; raised until the file fits comfortably.
const MIN_COUNT = 6;
const WORD = /^[a-z][a-z']*$/u;

const [corporaDir] = process.argv.slice(2);
if (corporaDir === undefined) {
  console.error('Usage: node scripts/context-table.mjs <corpora folder>');
  process.exit(1);
}

const known = new Set();
for (const entry of JSON.parse(readFileSync('node_modules/subtlex-word-frequencies/index.json', 'utf8'))) {
  known.add(entry.word.toLocaleLowerCase('en'));
}
for (const stem of ['en', 'en-gb', 'en-ca', 'en-au']) {
  for (const line of readFileSync(`node_modules/dictionary-${stem}/index.dic`, 'utf8').split(/\r?\n/u)) {
    const word = line.split('/')[0].trim().toLocaleLowerCase('en');
    if (word.length > 0) known.add(word);
  }
  for (const word of readFileSync(`public/spelling/extra-${stem}.txt`, 'utf8').split(/\r?\n/u)) {
    if (word.length > 0) known.add(word);
  }
}

const unigrams = new Map();
for (const line of readFileSync(join(corporaDir, 'bigrams', 'unigrams.tsv'), 'utf8').split('\n')) {
  const [word, count] = line.split('\t');
  if (word !== undefined && count !== undefined && WORD.test(word) && known.has(word)) unigrams.set(word, Number(count));
}

const rows = new Map();
let pairCount = 0;
for (const line of readFileSync(join(corporaDir, 'bigrams', 'pairs.tsv'), 'utf8').split('\n')) {
  const [left, right, count] = line.split('\t');
  if (left === undefined || right === undefined || count === undefined || Number(count) < MIN_COUNT) continue;
  if (!unigrams.has(left) || !unigrams.has(right)) continue;
  const row = rows.get(left) ?? new Map();
  row.set(right, Number(count));
  rows.set(left, row);
  pairCount += 1;
}

// Only words that take part in a pair need an id.
const vocabulary = [...new Set([...rows].flatMap(([left, row]) => [left, ...row.keys()]))].sort();
const ids = new Map(vocabulary.map((word, index) => [word, index]));
const countByte = (count) => Math.min(255, Math.round(10 * Math.log2(count)));

const bytes = [];
const pushU32 = (value) => bytes.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
const pushVarint = (value) => {
  let rest = value;
  while (rest >= 128) {
    bytes.push((rest & 127) | 128);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
};
for (const byte of Buffer.from('WWP1')) bytes.push(byte);
const vocabularyBytes = Buffer.from(vocabulary.join('\n'), 'latin1');
pushU32(vocabularyBytes.length);
for (const byte of vocabularyBytes) bytes.push(byte);
for (const word of vocabulary) bytes.push(countByte(unigrams.get(word)));
pushU32(pairCount);
pushU32(rows.size);
let previousLeft = 0;
for (const left of [...rows.keys()].sort((a, b) => ids.get(a) - ids.get(b))) {
  const row = rows.get(left);
  pushVarint(ids.get(left) - previousLeft);
  previousLeft = ids.get(left);
  pushVarint(row.size);
  let previousRight = 0;
  for (const right of [...row.keys()].sort((a, b) => ids.get(a) - ids.get(b))) {
    pushVarint(ids.get(right) - previousRight);
    previousRight = ids.get(right);
    bytes.push(countByte(row.get(right)));
  }
}
const output = 'public/spelling/pairs.bin';
writeFileSync(output, Buffer.from(bytes));
console.log(`${output}: ${pairCount.toLocaleString('en')} pairs with count >= ${MIN_COUNT}, ${vocabulary.length.toLocaleString('en')} words, ${bytes.length.toLocaleString('en')} bytes`);
