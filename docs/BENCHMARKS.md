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

Wordwarden core began from Harper's code. The benchmarks also run Harper on its own, on the holdout halves, as
its newest release ships it: its own engine file, dictionary and default rules, without Wordwarden's spelling
ranker, word lists, extra rules or engine changes. The difference shows what Wordwarden adds.

`harper/` is the unpacked `harper-chrome-plugin.zip` from Harper's newest GitHub release
(<https://github.com/Automattic/harper/releases/latest>, Apache 2.0); its engine file is run through the installed
`harper.js`, which only loads an engine file of its own version. Without the folder, the engine inside `harper.js` is
used. The Accuracy workflow downloads the newest release on each run and installs the `harper.js` of the same version.

## Resource use

`node scripts/resource-chart.mjs <LanguageTool folder> [report.json]` measures the built Chromium extension
(`npm run build`), Harper's browser extension and the LanguageTool server on the same machine, with the same
528-word text full of mistakes, and redraws `docs/resources.svg`. Harper is included when
`WORDWARDEN_HARPER_EXTENSION` names the unpacked `harper-chrome-plugin.zip` of its newest release. The Resources
workflow runs it on GitHub's Linux machine with the newest Harper and LanguageTool, for every release or by hand.

- **Extension memory:** each extension in Playwright's Chromium, against the same browser with no extension:
  private memory of all browser processes once every tab's text box has been focused and underlined, with 1 and
  with 20 tabs. Harper checks only a list of sites until checking everywhere is switched on, so the run switches
  it on. Before all tabs shared one checker (1.3.5), each Wordwarden tab started its own: 3 tabs added 708 MB.
- **CPU time to start:** for an extension, the CPU its one-tab run adds over the run with no extension, up to and
  including the first underlines; for LanguageTool, from launch to its first answer. CPU time is summed over all
  cores.
- **Check times:** each extension through its own check message, LanguageTool through its HTTP API.
  All get 3 warm-up checks and a 5-second pause (so Java compiling hot code is not counted), then 30 timed
  checks. Every check numbers each sentence afresh, so it is new text to all of them: Wordwarden keeps the findings
  of text that did not change, and the same text again would take about a millisecond. Time is the median; CPU
  per check is the average, over all processes involved.
- **LanguageTool:** the Java process serving the port, default setup without the n-gram data. Its memory
  varies by a few hundred MB between runs as Java collects garbage. Its browser extension, which a self-hosted
  setup also needs, is not counted.
- **Size on disk:** the unpacked extension against the unpacked LanguageTool download (Java not included).

## Metrics

- **Spelling lists:** detected (flagged at all), top-1 and top-3 (the right word is the first / in the
  first three suggestions). Pairs are split into `tune` and `holdout` by a stable hash of the right word, so
  no word is tuned on in one half and scored in the other; tune rules on failures from `tune`, report `holdout`.
- **Tweets and typing slips:** the same three numbers, but each mistake is checked inside its whole
  sentence. Tweets: `train` and `dev` are tune, `test` is holdout. Typing slips: sentences are split by
  a stable hash of the sentence people were asked to type (many typed the same one); a typed word is a mistake
  when it differs from the word the person was asked to type.
- **Where misses come from** (`diagnosis` under each spelling set, per half): the same numbers by how many letters
  the misspelling is from the right word (1, 2, 3, 4+), how often the right word was among the ranker's candidates
  at all (`inPool`), and where it ranked (`targetRank`: 1, 2, 3, 4–10, 11–32, 33+, not a candidate, flagged by
  another rule, not flagged). `holdoutMisses` is a fixed pseudo-random sample, not the first misses in the file.
- **Quicker runs and fitting:** `WORDWARDEN_BENCHMARK_COMPARE=0` skips plain Harper and LanguageTool (Wordwarden
  alone takes about three minutes). `WORDWARDEN_BENCHMARK_RANK_CASES=<file>` writes every tune-half misspelling
  with each candidate and its ranking signals, one JSON line each; the holdout halves are never written.
  `node scripts/rank-weights.mjs <file>` fits the ranker's weights on it (`RANK_WEIGHTS` in
  `src/engines/spelling-ranker.ts`, about a minute and a half).
- **Holbrook:** recall on tagged errors in context; spelling precision = spelling flags that land on a
  tagged error. Children's writing has many untagged grammar slips, so only spelling flags count.
- **JFLEG clean text:** the human corrections should get almost no underlines. `flaggedSentencesPct` is
  the main false-alarm number. Some flags are fair (the references are fluency edits, not perfect text);
  read the examples before acting.
- **JFLEG learner text:** a flag is *helpful* when applying its first fix moves the sentence closer
  (word edit distance) to at least one human correction. `fixPrecisionPct` is the main precision
  number; `sentenceRecallPct` is the share of sentences needing edits that get any flag. `dev` is tune,
  `test` is holdout.
- **Speed:** median time to check ~500 words the checker has not seen (seven different texts, after one
  warm-up). Before 2026-10-15 it timed the same text seven times. Target: under 100 ms.

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

## Changes — 2026-11-20

The benchmark itself changed first, so the published numbers move: word lists are now split by the right word, not
the misspelling (the same word was in both halves), and typing slips by the sentence people were asked to type. With
the code unchanged, holdout correct-word-first went Birkbeck 45.3% → 44.6%, Wikipedia 91.5% → 91.8%, typing slips
53.1% → 55.2%; tweets, Holbrook and JFLEG are unchanged. That re-split is the "before" below. Each change was kept
only if it helped on the tune halves and did not hurt the holdout halves; Wordwarden-only runs, plain Harper 3.3.0
and LanguageTool 6.6 rerun at the end.

- **Sentence-start capitals.** A lowercase misspelling that starts a sentence gets fixes with a capital ("becuse" →
  "Because"); JFLEG compares words with their case. JFLEG fixes that help: tune 59.2% → 59.5%, holdout 69.0% → 69.8%.
- **Initials.** "S." and "J.S.", which the core joins into one word, are no longer spelling mistakes. Holbrook
  spelling precision 89.4% → 89.9%.
- **Wider candidate pool and one blended score.** The core hands the ranker up to 48 candidates (was 10), case
  variants once, and words of six or more letters also get words three edits away. The ranker sorts by one score
  instead of distance first and then everything else, with weights fitted on the tune halves only
  (`scripts/rank-weights.mjs`). The right word among the candidates at all, Birkbeck holdout, three letters off:
  40.6% → 72.8%. A word from the user's dictionary one slip away still beats a common word two off (weight set by
  hand).
- **RegularIrregulars** ("buyed" → "bought") now wins over a spelling guess on the same word, as the core intends.
- **Informal spellings.** Words seen at least four times in the tune half of the tweets ("dat" → "that", "pls" →
  "please") come first, and a dropped "g" ("goin" → "going") counts in the score. Tweets holdout 70.3% → 74.1%.
- **Muted:** `UpdatePlaceNames` ("Turkey" → "Türkiye") and `LitotesDirectPositive` ("not unusual" → "common"),
  decided on the dev set and by reading them: opinions, not mistakes. JFLEG clean sentences flagged 5.8% → 5.5%.
- **Edit costs** (`scripts/edit-costs.mjs`) are now learned from the new tune halves too; the old table had seen
  some of today's holdout words (holdout moved by at most 0.2 points).
- **Tried and dropped** (worse on tune and holdout): no fix for a capitalised word two edits from any word (typing
  slips −0.4 / −0.2); WrongNegative over spelling guesses (fired on typos: "untill" → "distill"); lowercase
  acronyms ("ot" → "OT", "cors" → "CORS"). SplitWords over spelling guesses changed nothing.

Holdout, correct word first (top three in brackets); before is the re-split above:

| Benchmark | Before | After | Plain Harper 3.3.0 | LanguageTool 6.6 |
|---|---|---|---|---|
| Birkbeck | 44.6% (53.2%) | 44.8% (54.8%) | 36.1% | 36.7% |
| Wikipedia | 91.8% (95.3%) | 91.9% (96.0%) | 81.8% | 84.3% |
| Typing slips | 55.2% (60.2%) | 56.0% (60.8%) | 53.0% | 48.7% |
| Tweets | 66.8% (74.3%) | 74.0% (80.1%) | 61.1% | 59.4% |
| Holbrook | 30.8% (38.0%) | 32.8% (40.0%) | 18.4% | 25.3% |

JFLEG holdout: fixes that help 69.0% → 70.3% (Harper 64.0%, LanguageTool 60.2%), clean sentences flagged 5.7% →
5.5% (11.8%, 12.8%), sentences needing edits that get a flag 64.4% → 64.2% (66.4%, 72.7%). Speed on clean text
27 → 31 ms per 500 words; on JFLEG learner text, full of misspellings, about 78 → 100–110 ms (busy machine, noisy).

## Changes — 2026-10-15

Speed and memory work, with a few accuracy changes measured alongside. Local runs of Wordwarden only
(LanguageTool and plain Harper were not rerun); holdout numbers, before → after.

- **Spelling candidates.** nspell's `suggest()` took about 70% of each check; it is gone. The core now hands the
  ranker up to ten candidates instead of three, one-letter edits may produce contractions ("don;t" → don't),
  and words missing from the subtitle frequencies use their count in the news text of `pairs.bin`.
- **The core's four-edit search** compares the word with each dictionary word, using a bit-vector form of the
  edit distance, instead of building a 64 MB automaton: 8–10 ms per unknown word, with the same results.
- **Names.** An unknown word with a capital in mid-sentence is taken for a name unless its best suggestion is
  within two edits and starts with the same letter or one next to it on the keyboard.
- **Sections** are up to 400 characters (were 180), so fewer sentences are cut before the core sees them.
  The core's `LongSentences`, which the short sections had kept from firing, is muted.
- **Muted core rules** were all switched on once and read off the per-rule table: on the dev set none fixed
  more than a third of what it flagged, and together they flagged 116 clean sentences against 3 helpful fixes,
  so they stay off.
- **Wordwarden core.** The engine's source is now in `core/`, with its own interface instead of `harper.js`. It
  computes the noun-phrase network directly instead of through the Burn library (the same scores to the bit),
  and tries each pattern rule only where its first word is. `RegularIrregulars` now gives "chose" before
  "chosen" instead of in random order; on 5,002 texts that is the only difference in what the core finds.

| Benchmark | Detected | Top-1 | Top-3 |
|---|---|---|---|
| Birkbeck | 91.5% | 44.8% → 45.0% | 52.1% → 53.6% |
| Wikipedia | 98.8% | 90.7% | 96.0% → 96.3% |
| Typing slips | 68.2% → 67.5% | 51.9% → 52.8% | 58.3% → 58.4% |
| Tweets | 88.8% | 64.6% → 65.0% | 73.1% → 74.5% |
| Holbrook | 59.7% → 59.4% | 30.1% → 30.5% | 36.5% → 37.7% |

Holbrook spelling precision 84.1% → 86.3%. JFLEG: fixes that help 65.5% → 66.4%, sentences needing edits
that get a flag 64.6% (same), clean sentences flagged 6.5% → 5.9%. The lower detection on typing slips and
Holbrook is the names rule: slips in names are no longer flagged, nor are correct names.

Speed, in Node, old code against new run alternately on the same busy computer: a first check of ~500 new
words used about 625 → 205 ms of CPU, a check after changing one word 560 → 10 ms, the same text again 550 →
0.5 ms, and adding a dictionary word 270 → 10 ms (it used to rebuild the engine). The core work then took a
check of ~500 new words from about 75 to 25 ms, about 20 ms of it in the core (60 ms before), and left every
accuracy number above unchanged. The speed benchmark, which now times unseen text, gives 29 ms (80 ms before the
core work). The core's memory is 39 MB after start-up instead of 125 MB, and 45 MB instead of 221 MB after 300
sentences ([core](../core/README.md)).

## Changes — 2026-10-12

Five accuracy changes, measured together by the Accuracy workflow (the chart in the README is the
"after"; the 2026-10-11 table below is the "before"). Local spot checks are noted where they were run.

- **Per-rule precision table.** The JFLEG part of the benchmark now reports, for each rule, its flags,
  helpful fixes and flags on clean text, with examples. Rules were chosen from the dev set only.
- **Grammar rules muted or narrowed.** Twelve core rules that fired mostly on clean text and almost
  never helped are off (`MUTED_CORE_RULES` in `wordwarden-core.ts`). `CompoundSubjectAgreement` needs a
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
