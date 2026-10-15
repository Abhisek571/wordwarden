# `wordwarden-core`

The grammar and spelling engine of Wordwarden: it splits text into words and sentences, tags them, and runs the
spelling check and the grammar rules. It started as `harper-core` from [Harper](https://github.com/Automattic/harper)
2.10.0; see `../NOTICE`.

## Example

```rust
use wordwarden_core::linting::{LintGroup, Linter};
use wordwarden_core::parsers::PlainEnglish;
use wordwarden_core::spell::FstDictionary;
use wordwarden_core::{Dialect, Document};

let text = "This is an test.";
let parser = PlainEnglish;

let document = Document::new_curated(text, &parser);

let dict = FstDictionary::curated();
let mut linter = LintGroup::new_curated(dict, Dialect::American);

let lints = linter.lint(&document);

for lint in lints {
    println!("{:?}", lint);
}
```

## Features

`concurrent` (on by default): thread-safe primitives (`Arc` instead of `Rc`).
