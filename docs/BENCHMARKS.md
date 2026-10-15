# Accuracy benchmarks

Wordwarden is measured in four layers. Everything runs locally; benchmark data is never
bundled into the extension.

| Layer | Command | Data | Gate |
|---|---|---|---|
| Unit tests | `npm test` | in-repo | must pass |
| Grammar regression set | `npm test` (`tests/grammar-evaluation.test.ts`) | `tests/fixtures/grammar-cases.ts` | ≥ 65/66 fixed, 0 false alarms |
| Synthetic regression sets | `npm run evaluate:datasets` | `E:/downlode/*.csv` (`TYPECHECK_EVALUATION_DATASET_DIR`) | locked thresholds |
| Real-world benchmarks | `npm run evaluate:benchmarks` | `E:/CODING/Wordwarden/benchmarks` (`WORDWARDEN_BENCHMARK_DIR`) | report; compare before/after |
| Browser tests | `npm run test:e2e` (Chromium), `npm run test:firefox` (real Firefox) | `tests/fixtures/editor.html` | must pass |
| Real sites | manual | Gmail, GitHub, Reddit, Twitch in Chrome and Firefox | checklist below |

## Real-world datasets

Download into `WORDWARDEN_BENCHMARK_DIR` (default `E:/CODING/Wordwarden/benchmarks`). Missing files are skipped.
The weekly Accuracy workflow on GitHub downloads the same files from their original sites on each run and
redraws `docs/accuracy.svg`; none of the data is committed. It also adds the release's numbers to
`docs/accuracy-history.json` and redraws `docs/accuracy-history.svg`, the line chart across releases
(`node scripts/accuracy-history.mjs report.json`).

| Folder / file | Source | What it measures | Licence |
|---|---|---|---|
| `birkbeck/missp.dat` | Roger Mitton, <https://www.dcs.bbk.ac.uk/~ROGER/corpora.html> | 36k real misspellings (British, mostly children and students) | free research download, no stated licence |
| `birkbeck/wikipedia.dat` | same | misspellings by Wikipedia editors (American engine) | same |
| `birkbeck/holbrook-tagged.dat` | same | misspellings in running text, plus spelling false alarms | same |
| `jfleg/{dev,test}.{src,ref0..3}` | <https://github.com/keisks/jfleg> | learner sentences + 4 human corrections | CC BY-NC-SA 4.0 |
| `lexnorm/{train,dev,test}.norm` | LexNorm2015 (Baldwin et al., 2015), English part of MultiLexNorm, <https://huggingface.co/datasets/larrylawl/multilexnorm> | misspellings in tweets, in context; only one-word fixes within two letters are scored, so slang expansions ("lol") are left out | CC BY 4.0 |
| `aalto/sample.tsv` | 136M Keystrokes (Dhakal, Feit, Kristensson & Oulasvirta, CHI 2018), <https://userinterfaces.aalto.fi/136Mkeystrokes/>; sample made with `node scripts/aalto-sample.mjs Keystrokes.zip aalto/sample.tsv` | typing-test slips by 168,000 people, in context | free for research and non-commercial use with attribution |

## Comparison with LanguageTool

`languagetool/LanguageTool-6.6/` (from <https://languagetool.org/download/LanguageTool-6.6.zip>, LGPL 2.1, about
250 MB; needs Java 17 or newer) is run on the holdout halves for comparison. The benchmark starts it as a server
that only accepts connections from the same computer, and stops it when the run ends, fails or is interrupted.
It uses the default setup, without the optional n-gram data (about 8 GB), which would improve its results.
Missing LanguageTool is skipped.

## Comparison with Harper on its own

Harper is the grammar engine Wordwarden builds on. The benchmarks also run it on its own, on the holdout halves,
the way the `harper.js` package ships it: its own engine file, dictionary and default rules, without
Wordwarden's spelling ranker, word lists, extra rules or engine patch. The difference shows what Wordwarden
adds on top. Nothing needs downloading; it uses the installed `harper.js`.

## Resource use

`node scripts/resource-chart.mjs <LanguageTool folder> [report.json]` measures the built Chromium extension
(`npm run build`) and the LanguageTool server on the same machine, with the same 492-word text full of mistakes,
and redraws `docs/resources.svg`. The Resources workflow runs it on GitHub's Linux machine with the newest
LanguageTool, for bigger releases or by hand.

- **Wordwarden memory:** the extension in Playwright's Chromium; private memory of all browser processes before
  the text box is focused and once the underlines appear, with 1 and with 20 tabs. Before all tabs shared one
  checker (1.3.5), each tab started its own: 3 tabs added 708 MB, against about 315 MB since.
- **CPU time to start:** from focusing the first text box to its underlines, and for LanguageTool from launch
  to its first answer. CPU time is summed over all cores.
- **Check times:** Wordwarden through the extension's own check message, LanguageTool through its HTTP API.
  Both get 3 warm-up checks and a 5-second pause (so Java compiling hot code is not counted), then 30 timed
  checks. Time is the median; CPU per check is the average, over all processes involved.
- **LanguageTool:** the Java process serving the port, default setup without the n-gram data. Its memory
  varies by a few hundred MB between runs as Java collects garbage. Its browser extension, which a self-hosted
  setup also needs, is not counted.
- **Size on disk:** the unpacked extension against the unpacked LanguageTool download (Java not included).

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

## Changes — 2026-10-12

Five accuracy changes, measured together by the Accuracy workflow (the chart in the README is the
"after"; the 2026-10-11 table below is the "before"). Local spot checks are noted where they were run.

- **Per-rule precision table.** The JFLEG part of the benchmark now reports, for each rule, its flags,
  helpful fixes and flags on clean text, with examples. Rules were chosen from the dev set only.
- **Grammar rules muted or narrowed.** Twelve Harper rules that fired mostly on clean text and almost
  never helped are off (`MUTED_HARPER_RULES` in `harper-engine.ts`). `CompoundSubjectAgreement` needs a
  personal pronoun on one side, `SingularSubjectHave` skips modals, adverbs and relatives after the
  determiner, and `IntroductoryComma` keeps only sentence-initial "however". Local dev-set check, grammar
  rules only: fixes that help 51.9% → 66.5%, clean sentences flagged 12.1% → 7.6%, recall 63.0% → 60.0%.
- **Phonetic ranking.** `phonetic-key.ts` gives each word a sound key; words that sound like the
  misspelling join the candidates and rank as if one edit away. The tie-break rules became one numeric
  score (frequency times slip-type weights). Local holdout check, correct word first: Birkbeck 41.9% →
  44.0%, typing slips 48.6% → 51.2%, tweets 63.2% → 66.4%, Wikipedia 89.1% → 89.4%, Holbrook 28.1% →
  28.0%; top three up on all five; detection unchanged.
- **Learned edit costs.** `scripts/edit-costs.mjs` counts which slips actually happen in the tune halves
  of Birkbeck, Wikipedia and LexNorm and writes `src/engines/edit-costs.ts` (a↔e and c↔s cheap, a→z
  dear). The ranker weighs each candidate's edits with it. Not measured locally.
- **Word pairs in context.** `scripts/context-table.mjs` packs word-pair counts from the Leipzig Corpora
  Collection (CC BY 4.0, two 1M-sentence English news corpora, pairs seen at least 6 times) into
  `public/spelling/pairs.bin` (1.5 MB). Candidates that fit the words either side rank higher ("a letter
  form my friend" → from), and a `ConfusedWord` rule flags a real word from a confusion set when the pairs
  around it strongly favour the alternative. On 3,016 clean JFLEG dev sentences the rule gave 0 flags; it
  also found 0 on learner dev text, so it is precision-only for now.
- **More words.** SCOWL size 70 words that appear at least 3 times in the Leipzig corpora are bundled as
  `public/spelling/extra-*.txt` (about 4,300 per dialect, `scripts/extra-words.mjs`), so words such as
  "storyline" and "accelerometer" are no longer flagged. Not measured locally.

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
