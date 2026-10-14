# Harper engine

`harper_wasm_bg.wasm` is [Harper](https://github.com/Automattic/harper) 2.10.0, the grammar engine, built with
the changes in `wordwarden.patch`. It replaces the engine file that comes with the `harper.js` package; the
rest of `harper.js` is used unchanged. Both the browser extension and the LibreOffice add-on ship this file.

## What the patch changes

- Harper kept two complete copies of its built-in dictionary in memory: a cached one, and a copy of it inside
  the fast-lookup dictionary that checking actually uses. The fast-lookup dictionary is now built from its own
  copy, so only one is kept. This lowers the engine's memory after start-up from 161 MB to 125 MB.
- Harper caches its results for recent sentences, with an entry for every rule even when the rule found
  nothing. Only rules that found something are stored now.

What Harper finds is unchanged: on the 1,491 JFLEG sentences it returns exactly the same 4,398 results as the
official engine, and the accuracy benchmarks give the same numbers.

## Rebuilding

Needs git, [Rust](https://rustup.rs/) with `rustup target add wasm32-unknown-unknown`, and
[wasm-pack](https://github.com/rustwasm/wasm-pack) (`cargo install wasm-pack`). The current file was built
with Rust 1.99.0 and wasm-pack 0.15.0 on Windows.

```sh
node scripts/build-harper.mjs <work folder>
```

The script downloads Harper 2.10.0 into the work folder, applies the patch, builds the engine and copies it
here. Rust does not build this engine byte for byte the same every time, so a rebuild can differ from the
file here in its bytes, though not in what it finds. `tests/harper-wasm.test.ts` checks that the file still matches the installed `harper.js`; when
`harper.js` is updated, update `HARPER_TAG` in the script, rebuild, and rerun the accuracy benchmarks.
