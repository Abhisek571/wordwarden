import { readFileSync } from 'node:fs';

/** The bundled Wordwarden core engine (core/dist), as a URL the engine can load outside the browser. */
export const wordwardenCoreWasmUrl = `data:application/wasm;base64,${
  readFileSync(new URL('../../core/dist/wordwarden_core_bg.wasm', import.meta.url)).toString('base64')
}`;
