// Takes a fixed sample of mistyped sentences from the Aalto 136M Keystrokes zip for the accuracy benchmarks.
// Usage: node scripts/aalto-sample.mjs Keystrokes.zip sample.tsv
// Writes "target<TAB>typed" lines. The same zip always gives the same sample. Needs the `unzip` command.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAMPLE_SIZE = 10_000;
const BATCH = 200;
const [zipPath, outputPath] = process.argv.slice(2);
if (zipPath === undefined || outputPath === undefined) {
  throw new TypeError('Usage: node scripts/aalto-sample.mjs Keystrokes.zip sample.tsv');
}

function run(args) {
  const result = spawnSync('unzip', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr}`);
  return result.stdout;
}

// A stable shuffle of the people in the zip, so the sample does not depend on file order.
function hash(text) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

const people = run(['-Z1', zipPath])
  .split(/\r?\n/u)
  .filter((name) => /_keystrokes\.txt$/u.test(name))
  .sort((left, right) => hash(left) - hash(right) || left.localeCompare(right));

const clean = (text) => text.replace(/[\t\r\n]+/gu, ' ').trim();
// Only sentences with a word typed wrong count; a missing full stop or capital letter does not.
const words = (text) => text.toLocaleLowerCase('en').replace(/[^\p{L}\p{N}'\s]+/gu, '').split(/\s+/u).join(' ');
const lines = [];
const directory = mkdtempSync(join(tmpdir(), 'aalto-'));
try {
  for (let start = 0; start < people.length && lines.length < SAMPLE_SIZE; start += BATCH) {
    run(['-q', '-o', '-j', zipPath, ...people.slice(start, start + BATCH), '-d', directory]);
    for (const name of people.slice(start, start + BATCH)) {
      const file = join(directory, name.split('/').at(-1));
      const seen = new Set();
      // Most files are UTF-8; some older ones are Windows-1252 (curly apostrophes), so fall back to that.
      const bytes = readFileSync(file);
      const utf8 = new TextDecoder('utf-8').decode(bytes);
      const text = utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
      for (const row of text.split(/\r?\n/u).slice(1)) {
        const [, section, sentence, typed] = row.split('\t');
        if (section === undefined || typed === undefined || seen.has(section)) continue;
        seen.add(section);
        const target = clean(sentence ?? '');
        const input = clean(typed);
        if (target.length > 0 && input.length > 0 && words(target) !== words(input)) lines.push(`${target}\t${input}`);
        if (lines.length >= SAMPLE_SIZE) break;
      }
      if (lines.length >= SAMPLE_SIZE) break;
    }
    for (const leftover of readdirSync(directory)) rmSync(join(directory, leftover));
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
writeFileSync(outputPath, `${lines.join('\n')}\n`);
console.log(`Wrote ${lines.length} mistyped sentences to ${outputPath}.`);
