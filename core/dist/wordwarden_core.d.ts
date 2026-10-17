/* tslint:disable */
/* eslint-disable */

export class Checker {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adds words to the dictionary, as words of this checker's dialect.
     */
    add_words(words: string[]): void;
    /**
     * Checks plain text. The findings are ordered by rule name, then as the rule found them.
     */
    check(text: string): any;
    /**
     * Builds the dictionary and the rules, the slowest step of starting up.
     */
    constructor(dialect: Dialect);
    /**
     * Replaces the rule settings with an object such as `{ OxfordComma: false }`. Rules it does not name keep
     * their built-in setting.
     */
    set_rules(rules: any): void;
}

/**
 * An English dialect.
 */
export enum Dialect {
    American = 0,
    British = 1,
    Australian = 2,
    Canadian = 3,
    Indian = 4,
}

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_checker_free: (a: number, b: number) => void;
    readonly checker_add_words: (a: number, b: number, c: number) => void;
    readonly checker_check: (a: number, b: number, c: number) => [number, number, number];
    readonly checker_new: (a: number) => number;
    readonly checker_set_rules: (a: number, b: any) => [number, number];
    readonly start: () => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

/** Forgets the engine, so the next initialisation starts a new one. Added by scripts/build-core.mjs. */
export function resetCore(): void;
