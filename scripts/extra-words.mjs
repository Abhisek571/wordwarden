// Builds the supplementary word lists in public/spelling/extra-<stem>.txt: the words SCOWL size 70 adds on
// top of the shipped size-60 Hunspell dictionaries, kept only when they are common enough in real text.
// Usage: node scripts/extra-words.mjs <corpora folder>
// The folder holds scowl/extra-<us|gb|ca|au>-70.txt (one lower-case word per line: SCOWL size 70 minus
// the matching shipped dictionary) and bigrams/unigrams.tsv (word<TAB>count, from 2M Leipzig news
// sentences). Only the filtered word lists are shipped; the corpora stay out of the repo.
// Generated with: node scripts/extra-words.mjs E:\CODING\Wordwarden\corpora
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A word must appear this often in the 2M news sentences; below that the lists are mostly rare names.
const MIN_COUNT = 3;
const VARIANTS = { us: 'en', gb: 'en-gb', ca: 'en-ca', au: 'en-au' };

const [corporaDir] = process.argv.slice(2);
if (corporaDir === undefined) {
  console.error('Usage: node scripts/extra-words.mjs <corpora folder>');
  process.exit(1);
}

const counts = new Map();
for (const line of readFileSync(join(corporaDir, 'bigrams', 'unigrams.tsv'), 'utf8').split('\n')) {
  const [word, count] = line.split('\t');
  if (word !== undefined && count !== undefined) counts.set(word, Number(count));
}

mkdirSync('public/spelling', { recursive: true });
for (const [variant, stem] of Object.entries(VARIANTS)) {
  const words = readFileSync(join(corporaDir, 'scowl', `extra-${variant}-70.txt`), 'utf8')
    .split(/\r?\n/u)
    // Plain words of three letters or more: no possessives, abbreviations with dots, or accents.
    .filter((word) => /^[a-z]{3,}$/u.test(word) && (counts.get(word) ?? 0) >= MIN_COUNT)
    .sort();
  const output = join('public', 'spelling', `extra-${stem}.txt`);
  writeFileSync(output, `${words.join('\n')}\n`);
  console.log(`${output}: ${words.length} words`);
}
