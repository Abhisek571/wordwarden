// Rebuilds vendor/harper/harper_wasm_bg.wasm: Harper at the version below, with vendor/harper/wordwarden.patch
// applied. Needs git, Rust with the wasm32-unknown-unknown target, and wasm-pack (see vendor/harper/README.md).
// Usage: node scripts/build-harper.mjs <empty or existing work folder>
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARPER_TAG = 'v2.10.0';
const root = fileURLToPath(new URL('..', import.meta.url));
const work = process.argv[2];
if (work === undefined) {
  console.error('Usage: node scripts/build-harper.mjs <work folder>');
  process.exit(1);
}
const harper = resolve(work, 'harper');
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
// Error messages inside the engine name source files by path. Fixed names keep this computer's folders (and
// user name) out of the file, so builds in different folders come out the same.
const env = {
  ...process.env,
  RUSTFLAGS: [`--remap-path-prefix=${harper}=/harper`, `--remap-path-prefix=${cargoHome}=/cargo`].join(' '),
};
const run = (command, args, cwd) => execFileSync(command, args, { cwd, env, stdio: 'inherit' });

if (!existsSync(harper)) {
  run('git', ['clone', '--depth', '1', '--branch', HARPER_TAG, 'https://github.com/Automattic/harper.git', harper]);
}
run('git', ['checkout', '--force', HARPER_TAG], harper);
run('git', ['apply', join(root, 'vendor/harper/wordwarden.patch')], harper);
run('wasm-pack', ['build', '--target', 'web', '--out-name', 'harper_wasm', '--out-dir', 'pkg-wordwarden'], join(harper, 'harper-wasm'));
copyFileSync(join(harper, 'harper-wasm/pkg-wordwarden/harper_wasm_bg.wasm'), join(root, 'vendor/harper/harper_wasm_bg.wasm'));
console.log('Wrote vendor/harper/harper_wasm_bg.wasm');
