// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function shape(path: string): Readonly<{ imports: readonly string[]; exports: readonly string[] }> {
  const module = new WebAssembly.Module(readFileSync(new URL(path, import.meta.url)));
  return Object.freeze({
    imports: WebAssembly.Module.imports(module).map((entry) => `${entry.module}.${entry.name}:${entry.kind}`).sort(),
    exports: WebAssembly.Module.exports(module).map((entry) => `${entry.name}:${entry.kind}`).sort(),
  });
}

describe('bundled Harper engine', () => {
  // The patched engine is driven by harper.js's own JavaScript, so both must come from the same Harper version.
  // If harper.js is updated, rebuild vendor/harper for that version first (see vendor/harper/README.md).
  it('matches the installed harper.js', () => {
    expect(shape('../vendor/harper/harper_wasm_bg.wasm')).toEqual(shape('../node_modules/harper.js/dist/harper_wasm_bg.wasm'));
  });
});
