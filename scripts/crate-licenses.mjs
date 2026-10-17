// Writes core/dist/rust-crates-licenses.txt: the licences of every Rust crate compiled into the engine, which the
// browser packages and the LibreOffice add-on ship. Crates that only run at build time (proc macros) are left out.
// Run by scripts/build-core.mjs; needs Rust (see core/README.md).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const core = resolve(fileURLToPath(new URL('../core', import.meta.url)));
const output = join(core, 'dist', 'rust-crates-licenses.txt');
const cargo = (args) => execFileSync('cargo', args, { cwd: core, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// The crates in the engine for the wasm target: normal dependencies only, no dev or build ones.
const tree = cargo([
  'tree', '-p', 'wordwarden-wasm', '-e', 'normal', '--target', 'wasm32-unknown-unknown', '--prefix', 'none',
  '--format', '{p}',
]);
const linked = new Set(tree.split(/\r?\n/u)
  .filter((line) => line.length > 0 && !line.includes('(proc-macro)'))
  .map((line) => line.replace(/ \(.*\)$/u, '').trim()));

const metadata = JSON.parse(cargo(['metadata', '--format-version', '1', '--filter-platform', 'wasm32-unknown-unknown']));
const LICENSE_FILE = /^(?:licen[cs]e|copying|unlicense|notice)/iu;
// Most crates ship the same Apache or MIT text with their own copyright line, so each distinct text is printed once,
// numbered, and every crate names the texts that apply to it.
const texts = new Map();
const crates = [];
for (const crate of [...metadata.packages].sort((left, right) => left.name.localeCompare(right.name))) {
  if (!linked.has(`${crate.name} v${crate.version}`) || crate.name.startsWith('wordwarden')) continue;
  const directory = dirname(crate.manifest_path);
  const files = existsSync(directory) ? readdirSync(directory).filter((name) => LICENSE_FILE.test(name)).sort() : [];
  const numbers = files.map((name) => {
    const text = readFileSync(join(directory, name), 'utf8').replaceAll('\r\n', '\n').trim();
    if (!texts.has(text)) texts.set(text, texts.size + 1);
    return texts.get(text);
  });
  const which = numbers.length > 0 ? ` (text ${numbers.join(', ')})` : '';
  crates.push(`${crate.name} ${crate.version}: ${crate.license ?? 'see the crate'}${which}`);
}
writeFileSync(output, [
  'Rust crates compiled into Wordwarden core (wordwarden_core_bg.wasm), with their licences. The numbered texts follow.',
  crates.join('\n'),
  ...[...texts].map(([text, number]) => `Text ${number}\n\n${text}`),
].join(`\n\n${'='.repeat(80)}\n\n`) + '\n');
console.log(`Wrote ${output}: ${crates.length} crates, ${texts.size} licence texts`);
