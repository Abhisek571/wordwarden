# Wordwarden

Wordwarden is a free, privacy-first browser extension for one-click English
spelling and grammar corrections. Text stays on the device, and all checks use
only assets packaged with the extension.

## Features

- Chrome, Edge, and Firefox builds from one WXT codebase.
- Local Harper grammar checks plus dialect-aware spelling candidate ranking.
- Three quality-ranked, one-click corrections with no silent text changes.
- Standard input, textarea, and contenteditable support.
- Click to correct; use × or Escape to close a suggestion without ignoring it.
- Local dictionary, ignored issues, dialect, and per-site controls.
- Offline recognition of [popular company and technical names](docs/POPULAR_VOCABULARY.md),
  including OpenAI, SpaceX, and lowercase variants; built-in terms stay separate from your dictionary.
- Experimental Google Docs detection with a safe companion fallback.

## Accuracy

Measured on public test sets that are not bundled with the extension, using held-out
data that was not used for tuning (October 2026). Full method and caveats:
[docs/BENCHMARKS.md](docs/BENCHMARKS.md).

| Test set | Result |
|---|---|
| [Wikipedia misspellings](https://www.dcs.bbk.ac.uk/~ROGER/corpora.html) | 98.8% caught; right word first 89.1%, in top three 95.0% |
| [Aspell test set](https://www.dcs.bbk.ac.uk/~ROGER/corpora.html) | 96.8% caught; right word first 55.0%, in top three 70.1% |
| [Birkbeck spelling errors](https://www.dcs.bbk.ac.uk/~ROGER/corpora.html) (many by children and students) | 91.9% caught; right word first 41.9%, in top three 49.5% |
| [JFLEG](https://github.com/keisks/jfleg) learner essays | flags 67.4% of sentences that need edits; 58.1% of first fixes move the text closer to a human correction |
| JFLEG human-corrected text | 11.3% of sentences get any underline (an upper bound on false alarms; the references are not perfect) |
| Speed | 73 ms median to check 535 words on a desktop PC |

Wordwarden catches most everyday typos but still misses many grammar and fluency
problems. It never changes text without a click.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
npm run dev:firefox
```

## Try it locally

After loading the unpacked extension, click **Open typing test page** in the
Wordwarden popup. The typing test is included in the extension, so it does not
need a separate local server. Type in the text box and pause briefly to see
local grammar and spelling suggestions.

## Verification

```sh
npm run compile
npm test
npm run build
npm run build:firefox
npm run lint:firefox
npm run test:e2e
```

Load `.output/chrome-mv3` as an unpacked extension in Chrome or Edge. Use
`.output/firefox-mv3` for temporary Firefox loading. `npm run zip` and
`npm run zip:firefox` create store archives.

The Playwright smoke test needs an open-source Chromium build that permits
command-line extension loading. Branded Chrome and Edge removed those flags
in version 137 and later.

See `docs/PRIVACY.md`, `docs/PERMISSIONS.md`, and `THIRD_PARTY_NOTICES.md`.

Before publishing or uploading the extension, complete every blocker in
`RELEASE_TODO.md`.
