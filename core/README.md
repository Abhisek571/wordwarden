# Wordwarden core

The grammar and spelling engine under Wordwarden's own layer (the spelling ranker, word lists and local rules in
`src/engines`). It is written in Rust and compiled to WebAssembly. The browser extension and the LibreOffice add-on
ship `dist/wordwarden_core_bg.wasm`, loaded by the JavaScript in `dist/wordwarden_core.js`.

It started as [Harper](https://github.com/Automattic/harper) 2.10.0 and is licensed, like Harper, under the Apache
License 2.0 (see `NOTICE` and `LICENSE`).

| Folder | What is in it |
|---|---|
| `wordwarden-core` | Splitting text into words and sentences, the dictionary, the spelling check and the grammar rules |
| `wordwarden-brill` | The part-of-speech tagger and the noun-phrase finder, with their trained data |
| `wordwarden-pos-utils` | Tagging and chunking code used by `wordwarden-brill` |
| `wordwarden-wasm` | The WebAssembly interface: a `Checker` that checks plain text and returns plain objects |
| `dist` | The built engine and its JavaScript, kept in the repository so the extension builds without Rust |

## Changes from Harper 2.10.0

- Only the parts Wordwarden uses are here: no thesaurus, Typst or other document parsers, language server or
  command-line tools. Harper's `harper-wasm` and the `harper.js` package are replaced by `wordwarden-wasm`, which
  checks a text in one call and returns plain objects, so nothing has to be freed one by one.
- Harper keeps two complete copies of its built-in dictionary in memory: a cached one, and a copy inside the
  fast-lookup dictionary that checking uses. The core keeps one, and builds the fast-lookup map over it without
  copying it.
- Harper keeps the dictionary's 134,790 words in a hash table of whole entries, about half of it empty. The core
  keeps them in one list with a small index, and reserves room for them once instead of growing the table.
- Harper's rule for missing spaces ("insteadof") builds a prefix tree of the whole dictionary at start-up. The core
  looks each start of the word up in the dictionary instead, which finds the same words.
- Harper caches its results for recent sentences, with an entry for every rule even when the rule found nothing.
  The core stores only rules that found something, and hashes the rule settings once per check instead of once
  per sentence.
- For a word with no match within three edits, Harper searches four edits away with an automaton that takes about
  a second and 64 MB to build, and keeps it. The core compares the word with each dictionary word instead, using a
  bit-vector form of the same edit distance (about 8 ms for a lowercase word and 10 ms for a capitalised one), with
  nothing to build or keep. A capitalised word is compared with dictionary words that have no capitals in
  lowercase only, since that is never further from them.
- Harper finds noun phrases with a small neural network (a bidirectional LSTM) run through the Burn
  machine-learning library, which spends most of its time on general tensor work. The core computes the same
  network directly (`LstmChunker`), from the same weights converted to `wordwarden-brill/finished_chunker/weights.bin`
  and in the same order of operations: on 807,762 words in WebAssembly its scores were the same as Burn's to the
  bit. Burn is no longer needed.
- Harper tries each of its 743 pattern rules at every word. For 654 of them the core works out which words a match
  can start with, and tries them only where one of those words is (`first_words_cover_every_match` checks on the
  test texts that no match starts anywhere else).
- Spelling mistakes come with up to ten suggestions instead of three, which Wordwarden's ranker sorts again with
  word frequency, typing slips and context.
- `RegularIrregulars` gave its fixes for a verb ("chose", "chosen") in random order; the core gives the simple past
  first.

In Node, the core's memory, which never shrinks, is 39 MB after start-up instead of Harper's 161 MB, and 45 MB
instead of 225 MB after checking 300 learner sentences. Start-up takes 0.4 s instead of 0.9 s, and checking 500
words it has not seen about 20 ms instead of 60 ms. The engine file is 6.6 MB instead of 16.1 MB. Apart from the
extra suggestions and the fixed order above, the core finds the same as Harper 2.10.0: on 5,002 texts (the JFLEG
sentences and 2,000 Birkbeck misspellings) both return the same 9,959 results, with the same first three
suggestions. Harper's snapshot tests in `wordwarden-core/tests` were updated for the extra suggestions.

## Building

Needs [Rust](https://rustup.rs/) with `rustup target add wasm32-unknown-unknown`, and
[wasm-pack](https://github.com/rustwasm/wasm-pack) (`cargo install wasm-pack`). From the repository's root:

```sh
node scripts/build-core.mjs
```

This writes `dist`. Rust does not build the engine byte for byte the same every time, so a rebuild can differ from
the committed file in its bytes, though not in what it finds. The current file was built with Rust 1.99.0 and
wasm-pack 0.15.0 on Windows.

## Testing

```sh
cargo test --workspace
```

The extension's own tests (`npm test` in the repository's root) also run the built engine in `dist`.
