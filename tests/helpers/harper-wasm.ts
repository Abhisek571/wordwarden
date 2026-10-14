import { readFileSync } from 'node:fs';

/** The bundled Harper engine (vendor/harper), as a URL the engine can load outside the browser. */
export const harperWasmUrl = `data:application/wasm;base64,${
  readFileSync(new URL('../../vendor/harper/harper_wasm_bg.wasm', import.meta.url)).toString('base64')
}`;
