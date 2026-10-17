# Changelog

Each release's section is also its release notes on GitHub. Accuracy and resource numbers are in the
README charts; method in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## 1.6.1 — 2026-10-17

- **Checking no longer stops.** Text such as "I want both 3" or "THERE'S PEOPLE" crashed the engine, and checking
  then stopped in every tab. Both are fixed, and if the engine ever fails it now restarts by itself.
- **Fixes that add a word keep yours.** "a lot people" now becomes "a lot of people", not "a  of people".
- **Better spelling suggestions.** Lowercase names get their capitals ("london" → "London", "i'm" → "I'm"), lowercase
  typos get lowercase fixes, and another dialect's spelling gets your dialect's word first ("colour" → "color",
  "gray" → "grey"). Slurs and sexual words are no longer offered as guesses.
- Specific fixes such as "1960's" → "1960s" and "atall" → "at all" are no longer hidden behind a spelling guess.
- "Does anyone know the answer?" and similar questions are no longer flagged.
- Fields inside frames, such as embedded comment boxes, are checked.
- Alt+1–3 now works only in the field being checked, and is off on macOS, where Option with a digit types a character.
- A fix is never written into another field, such as a password box, after its own field was removed.
- Email and web address fields are no longer checked.
- Dictionary words are limited to 80 characters; a pasted very long "word" stopped checking everywhere.
- LibreOffice: misspellings before a full stop or another word are underlined again, and the engine recovers after a
  failure.

## 1.6.0 — 2026-10-15

- **Wordwarden's own engine.** Spelling and grammar are now checked by Wordwarden core, our own engine. It
  began from Harper's code and has been reworked into a separate engine: it uses about a quarter of the memory,
  starts in half the time and checks new text about three times as fast, and finds the same mistakes.
- Typing in long rich editors is lighter: the text is read once you pause, not on every key.
- Underlines in long text boxes are placed in one pass instead of one at a time.
- Fixes for wrong verb forms such as "choosed" always offer "chose" before "chosen".
- The website compares resource use with Harper and LanguageTool again.

## 1.5.2 — 2026-10-13

- A text box that already had focus when a page finished loading is now checked straight away, instead of
  only after the next keystroke.

## 1.5.1 — 2026-10-13

- **Fixes now work in Twitch chat.** A picked suggestion used to land at the end of the message ("sdasad")
  instead of replacing the word, because Twitch puts its old cursor back when the chat box gets focus.
- No more "Could not apply this suggestion safely" after a fix that worked, in editors that redraw a moment
  later, such as Twitch chat.
- Messages such as "The text changed" now disappear after a few seconds instead of staying on the page.

## 1.5.0 — 2026-10-12

- **Better spelling suggestions.** The correct word comes first more often, especially for sound-alike
  spellings ("becos", "frends") and typing slips. Suggestions now take the words around a mistake into
  account, and rank slips by how often people actually make them.
- **Fewer false alarms.** Twelve grammar checks that mostly flagged correct text are off, and three are
  narrower. About half as many correct sentences get an underline, and grammar fixes are right more often.
- **More words known.** About 4,300 more everyday words, such as "storyline" and "accelerometer", are no
  longer flagged, in the browser and in LibreOffice.
- Real-word slips such as "form" for "from" are flagged when the words around them make it clear.
- A test in real Firefox now runs on every change.

Measured on held-out test data against 1.4.0: correct word first +1.4 to +3.2 points on every spelling
set, helpful grammar fixes 58.1% → 65.6%, correct sentences flagged 11.3% → 6.5%, grammar mistakes
caught 67.4% → 64.6%.

## 1.4.0 — 2026-10-11

- All tabs share one checker instead of starting their own, so many open tabs use far less memory and
  later tabs show underlines sooner.
- New resource chart comparing memory, CPU and size with a LanguageTool server.

## 1.3.5 — 2026-10-11

- First version of the shared checker for all tabs.

## 1.3.4 — 2026-10-11

- The Firefox package builds from the sources zip, which has no `.gitignore`.

## 1.3.3 — 2026-10-11

- Licensed under the GNU General Public License v3.0 only.

## 1.3.2 — 2026-10-11

- Release fix: the LibreOffice add-ons are attached to the release again.

## 1.3.1 — 2026-10-11

- Release fix for building the LibreOffice add-on.

## 1.3.0 — 2026-10-11

- New LibreOffice add-on with the same spelling and grammar engine, for Windows, macOS and Linux.
- Applying a suggestion in rich text editors replaces the right word.

## 1.2.1 — 2026-10-11

- Export and import moved to Advanced in Settings, and now include all settings.
- Settings show the licence, the version and a link to the source code.

## 1.2.0 — 2026-10-11

- Clearer diagnostic log for bug reports.
- The accuracy chart compares Wordwarden with LanguageTool.

## 1.1.0 — 2026-10-11

- Accuracy chart in the README, redrawn for each bigger release.

## 1.0.1 — 2026-10-11

- First public release.
