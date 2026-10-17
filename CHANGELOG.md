# Changelog

Each release's section is also its release notes on GitHub. Accuracy and resource numbers are in the
README charts; method in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## 1.6.2 — 2026-10-17

- **Harper's newer rules and dictionary.** The rules and fixes Harper added in 2.11 and 2.12 are in, such as
  "comfortable of" → "comfortable with" and "such shame" → "such a shame", and about 40 modern words (worktree,
  permalink, framerate) are no longer flagged. "its" after a preposition and "one of the latter" are no longer flagged.
- **Better spelling.** "im" → "I'm", "beautifull" → "beautiful", "advices" → "advice", "thats" → "that's", and a
  spelling that your dialect's dictionary accepts ("dreamed" in British English) is no longer flagged.
- **Fewer false alarms from Wordwarden's own rules.** "Everything I told you was true", "The rest have gone", "Is he
  seen as…" and similar sentences are no longer flagged. "Add a full stop" no longer fires on sign-offs, headings,
  short chat lines, links or addresses, and never hides a real mistake on the last word.
- Mistakes that cross the cut between two parts of a long text, and the last words of a long text, are found again.
  Long links no longer get underlines inside them.
- Fixes for stray spaces and quotes ("Hello , world", "said\"hello") are offered.
- **Underlines stay right.** They follow the field when the page moves it or it is resized, disappear when it is
  removed, and are drawn in right-to-left fields. Editors that change text without typing (undo in some editors,
  Wikipedia's source editor) are checked again.
- The card no longer closes on the way from the word to it, closes when you click elsewhere, and its underlines are
  easier to see on white fields. Underlines are no longer in the Tab order.
- After an update the old underlines are removed from open pages. Turning Wordwarden or a site back on works without
  reloading. A page's own styles can no longer hide the underlines.
- Fields that were password fields stay unchecked after "show password". "plaintext-only" rich text boxes are checked.
- "Ignore" hides only the suggestion you chose. Note: suggestions ignored before this version show once more.
- Settings: a pasted list of words is added word by word, importing a word list keeps changes made meanwhile, full
  lists say so, and the page follows changes made on a web page. Two tabs saving at once no longer lose a change.
- Browsers set to New Zealand, Irish, Indian, South African and other Commonwealth English start with that spelling.
- LibreOffice: checking comes back a minute after the engine fails, English (Philippines) uses American spelling, and
  the add-on ships all its licence texts.
- The browser packages include Wordwarden's own licence and the licences of the engine's Rust libraries.

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
  began from Harper's code and has been reworked into a separate engine. On its own it uses about a quarter of
  Harper's memory and starts in half the time; in the browser the extension uses about half the memory of 1.5.2
  and checks new text many times as fast. It finds the same mistakes.
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
