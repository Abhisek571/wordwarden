# Third-Party Notices

- Harper: Apache License 2.0, Copyright Harper contributors. Wordwarden core, the bundled grammar engine
  (`wordwarden_core_bg.wasm`, source in the `core` folder), is derived from Harper 2.10.0 and changed since; see
  `core/NOTICE` in the source code.
- Rust crates compiled into Wordwarden core, under MIT, Apache-2.0, Unlicense, Zlib, BSD, Unicode-3.0 and MPL-2.0
  licenses: listed with their license texts in `licenses/Rust-crates.txt`.
- Node.js, bundled in the LibreOffice add-on to run the checking engine: MIT License, Copyright Node.js
  contributors. Its full license is in the add-on's `licenses` folder.
- WXT: MIT License, Copyright Aaron Klinker and contributors.
- React: MIT License, Copyright Meta Platforms, Inc. and affiliates.
- nspell: MIT License, Copyright Titus Wormer and contributors.
- English Hunspell dictionaries (`dictionary-en`, `dictionary-en-au`,
  `dictionary-en-ca`, and `dictionary-en-gb`): MIT AND BSD licenses,
  dictionary contributors.
- SUBTLEX word-frequency package: ISC License, Copyright Zeke Sikelianos.
- Supplementary English word lists (`spelling/extra-*.txt`), drawn from SCOWL (Spell Checker Oriented
  Word Lists) size 70, which builds on the public-domain 12Dicts, Moby Words and ENABLE packages:
  Copyright 2000-2018 by Kevin Atkinson. "Permission to use, copy, modify, distribute and sell these
  word lists, the associated scripts, the output created from the scripts, and its documentation for
  any purpose is hereby granted without fee, provided that the above copyright notice appears in all
  copies and that both that copyright notice and this permission notice appear in supporting
  documentation. Kevin Atkinson makes no representations about the suitability of this array for any
  purpose. It is provided "as is" without express or implied warranty."
- Word-pair frequencies (`spelling/pairs.bin`) derived from the Leipzig Corpora Collection (Wortschatz
  Leipzig, Universität Leipzig), corpora eng_news_2023_1M and eng_news_2024_1M,
  https://wortschatz.uni-leipzig.de/en/download/English, licensed under CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/). Counts were recomputed and pruned.

The distributed package must include the complete notices and license texts
from installed dependency packages.
