// Builds Wordwarden core from the Rust sources in core/ into core/dist: the WebAssembly engine and the JavaScript
// that loads it. Needs Rust with the wasm32-unknown-unknown target, and wasm-pack (see core/README.md).
// Usage: node scripts/build-core.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const core = resolve(fileURLToPath(new URL('../core', import.meta.url)));
const dist = join(core, 'dist');
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
// Error messages inside the engine name source files by path. Fixed names keep this computer's folders (and user
// name) out of the file, so builds in different folders come out the same. The encoded form allows spaces in paths.
const env = {
  ...process.env,
  CARGO_ENCODED_RUSTFLAGS: [`--remap-path-prefix=${core}=/core`, `--remap-path-prefix=${cargoHome}=/cargo`].join('\x1f'),
};
execFileSync('wasm-pack', [
  'build', 'wordwarden-wasm', '--release', '--target', 'web', '--out-name', 'wordwarden_core', '--out-dir', dist,
], { cwd: core, env, stdio: 'inherit' });
// wasm-pack also writes an npm package file, a readme and a .gitignore that would hide the folder from git.
const keep = new Set(['wordwarden_core.js', 'wordwarden_core.d.ts', 'wordwarden_core_bg.wasm', 'wordwarden_core_bg.wasm.d.ts']);
for (const file of readdirSync(dist)) {
  if (!keep.has(file)) rmSync(join(dist, file));
}
console.log('Wrote core/dist');
