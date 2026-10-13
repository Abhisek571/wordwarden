# Changelog

Each release's section is also its release notes on GitHub. Accuracy and resource numbers are in the
README charts; method in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

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
