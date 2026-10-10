# Accuracy benchmarks

Wordwarden is measured in four layers. Everything runs locally; benchmark data is never
bundled into the extension.

| Layer | Command | Data | Gate |
|---|---|---|---|
| Unit tests | `npm test` | in-repo | must pass |
| Grammar regression set | `npm test` (`tests/grammar-evaluation.test.ts`) | `tests/fixtures/grammar-cases.ts` | ≥ 65/66 fixed, 0 false alarms |
| Synthetic regression sets | `npm run evaluate:datasets` | `E:/downlode/*.csv` (`TYPECHECK_EVALUATION_DATASET_DIR`) | locked thresholds |
| Real-world benchmarks | `npm run evaluate:benchmarks` | `E:/CODING/Wordwarden/benchmarks` (`WORDWARDEN_BENCHMARK_DIR`) | report; compare before/after |
| Real sites | manual | Gmail, GitHub, Reddit, Twitch in Chrome and Firefox | checklist below |

## Real-world datasets

Download into `WORDWARDEN_BENCHMARK_DIR` (default `E:/CODING/Wordwarden/benchmarks`). Missing files are skipped.
The weekly Accuracy workflow on GitHub downloads the same files from their original sites on each run and
redraws `docs/accuracy.svg`; none of the data is committed.

| Folder / file | Source | What it measures | Licence |
|---|---|---|---|
| `birkbeck/missp.dat` | Roger Mitton, <https://www.dcs.bbk.ac.uk/~ROGER/corpora.html> | 36k real misspellings (British, mostly children and students) | free research download, no stated licence |
| `birkbeck/wikipedia.dat` | same | misspellings by Wikipedia editors (American engine) | same |
| `birkbeck/holbrook-tagged.dat` | same | misspellings in running text, plus spelling false alarms | same |
| `jfleg/{dev,test}.{src,ref0..3}` | <https://github.com/keisks/jfleg> | learner sentences + 4 human corrections | CC BY-NC-SA 4.0 |
| `lexnorm/{train,dev,test}.norm` | LexNorm2015 (Baldwin et al., 2015), English part of MultiLexNorm, <https://huggingface.co/datasets/larrylawl/multilexnorm> | misspellings in tweets, in context; only one-word fixes within two letters are scored, so slang expansions ("lol") are left out | CC BY 4.0 |
| `aalto/sample.tsv` | 136M Keystrokes (Dhakal, Feit, Kristensson & Oulasvirta, CHI 2018), <https://userinterfaces.aalto.fi/136Mkeystrokes/>; sample made with `node scripts/aalto-sample.mjs Keystrokes.zip aalto/sample.tsv` | typing-test slips by 168,000 people, in context | free for research and non-commercial use with attribution |

## Metrics

- **Spelling lists:** detected (flagged at all), top-1 and top-3 (the right word is the first / in the
  first three suggestions). Pairs are split by a stable hash into `tune` and `holdout`; tune rules on
  failures from `tune`, report `holdout`.
- **Tweets and typing slips:** the same three numbers, but each mistake is checked inside its whole
  sentence. Tweets: `train` and `dev` are tune, `test` is holdout. Typing slips: sentences are split by
  a stable hash; a typed word is a mistake when it differs from the word the person was asked to type.
- **Holbrook:** recall on tagged errors in context; spelling precision = spelling flags that land on a
  tagged error. Children's writing has many untagged grammar slips, so only spelling flags count.
- **JFLEG clean text:** the human corrections should get almost no underlines. `flaggedSentencesPct` is
  the main false-alarm number. Some flags are fair (the references are fluency edits, not perfect text);
  read the examples before acting.
- **JFLEG learner text:** a flag is *helpful* when applying its first fix moves the sentence closer
  (word edit distance) to at least one human correction. `fixPrecisionPct` is the main precision
  number; `sentenceRecallPct` is the share of sentences needing edits that get any flag. `dev` is tune,
  `test` is holdout.
- **Speed:** median time to check ~500 words. Target: under 100 ms.

## Rules

1. Precision first. A change must not lower clean-text or fix precision, even if recall rises.
2. Tune on `tune` / `dev`; report `holdout` / `test`.
3. Note the before/after numbers with each accuracy change.
4. Read the failure examples each run, not just the scores.

## Manual real-site checklist (before each release, Chrome and Firefox)

- [ ] Gmail compose with 3+ paragraphs: underlines sit on the right words; apply a fix; Ctrl+Z / Ctrl+Shift+Z.
- [ ] GitHub issue comment (textarea): same.
- [ ] Reddit post editor (rich text): same.
- [ ] Twitch chat (single-line input): underline and apply.
- [ ] Password and card fields: no underlines, no badge.
- [ ] Badge shows checking → count / tick; clicking it opens the first suggestion.
- [ ] Suggestion card near the bottom of the window opens above the word.
- [ ] Turn the site off in the popup: underlines disappear without a reload.

## Results — 2026-10-11

Holdout numbers, full run about 17 minutes. Adds the tweet and typing-slip sets; the Aspell list is dropped
(small, and covered by Wikipedia).

| Benchmark | Mistakes scored | Detected | Top-1 | Top-3 |
|---|---|---|---|---|
| Typing slips (Aalto sample) | 4,840 | 68.4% | 48.6% | 57.2% |
| Tweets (LexNorm2015 test) | 903 | 89.4% | 63.2% | 70.5% |
| Wikipedia misspellings | 1,094 | 98.8% | 89.1% | 94.8% |
| Birkbeck | 16,390 | 91.9% | 41.9% | 49.4% |
| Holbrook (in context) | 2,599 | 61.2% | 28.1% | 33.7% |

JFLEG and Holbrook precision are unchanged from 2026-10-08. Many missed typing slips make another real word
("can" for "can't", "beach" for "bench"), which a spelling check alone cannot catch.

## Results — 2026-10-08

Full run: about 14 minutes (`npm run evaluate:benchmarks`). Holdout numbers. "Before" is the first baseline;
"after" adds the false-alarm fixes below.

| Benchmark | Detected | Top-1 | Top-3 | Precision |
|---|---|---|---|---|
| Birkbeck (36k real misspellings, many by young children) | 91.9% | 41.9% | 49.5% | — |
| Wikipedia misspellings | 98.8% | 89.1% | 95.0% | — |
| Aspell test set | 96.8% | 55.0% | 70.1% | — |
| Holbrook (typos in children's running text) | 60.8% → 61.2% | 28.1% | 34.4% | spelling 83.5% |
| JFLEG learner text | 68.1% → 67.4% of sentences needing edits | — | — | 56.7% → 58.1% of fixes help |
| JFLEG clean text | 13.2% → 11.3% of sentences flagged (14.4 → 12.5 flags / 100) | — | — | — |
| Speed | 535 words in 90 → 73 ms (median) | | | |

Fixes in the "after" run:
- `IntroductoryComma` only at a sentence start ("can therefore adapt" and "instead of" stay clean).
- `CompoundSubjectAgreement` skips a new clause ("others and he has succeeded").
- `SingularSubjectHave` skips collective and plural-sense nouns ("the youth have") and pronouns ("that I have").
- Personal and bundled words are suggested only for near misses (no "Chicugta → chatgpt").
- `PluralQuantityUnit` skips modifiers after "a"/"an" ("a two week trip" → "two-week").
- `IndefiniteSubjectAgreement` flags "Everyone know" at a sentence start.
- A common finished word at the end ("tomorrow") is no longer treated as half-typed, so missing end
  punctuation is caught: synthetic punctuation exact rows 665 → 1,826 with 0 unnecessary rows.

Reading the results:
- JFLEG references are not perfectly clean (e.g. "may parts of India", "must must"), so the clean-text
  rate is an upper bound on false alarms; read the examples.
- Birkbeck includes very poor spellings from spelling tests; Wikipedia/Aspell are closer to adult typing.
