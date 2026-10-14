<div align="center">
  <a href="https://abhisek571.github.io/wordwarden/"><img src="public/icon.svg" width="96" alt="Wordwarden"></a>
  <h1>Wordwarden</h1>
  <p><strong>Spelling and grammar checks that never leave your device.</strong><br>
  Free and open source, for Firefox, Chromium browsers and LibreOffice.</p>
  <p>
    <a href="https://abhisek571.github.io/wordwarden/"><strong>Website</strong></a> ·
    <a href="https://addons.mozilla.org/en-GB/firefox/addon/wordwarden-spell-grammar/">Firefox Add-ons</a> ·
    <a href="https://github.com/Abhisek571/wordwarden/releases/latest">Downloads</a> ·
    <a href="CHANGELOG.md">Changelog</a>
  </p>
  <p>
    <a href="https://github.com/Abhisek571/wordwarden/actions/workflows/ci.yml"><img alt="Tests" src="https://github.com/Abhisek571/wordwarden/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://addons.mozilla.org/en-GB/firefox/addon/wordwarden-spell-grammar/"><img alt="Firefox Add-ons" src="https://img.shields.io/amo/v/wordwarden-spell-grammar?label=Firefox%20Add-ons"></a>
    <a href="https://addons.mozilla.org/en-GB/firefox/addon/wordwarden-spell-grammar/"><img alt="Users" src="https://img.shields.io/amo/users/wordwarden-spell-grammar"></a>
    <a href="LICENSE"><img alt="Licence: GPL v3" src="https://img.shields.io/badge/licence-GPL%20v3-blue"></a>
  </p>
</div>

Wordwarden underlines English spelling and grammar mistakes as you type and fixes them in one click. Every
check runs on the device with files bundled in the package; nothing the user writes is sent anywhere.
Accuracy and performance charts are on the [website](https://abhisek571.github.io/wordwarden/).

## Install

- **Firefox:** from [Firefox Add-ons](https://addons.mozilla.org/en-GB/firefox/addon/wordwarden-spell-grammar/).
  It updates itself.
- **Chromium browsers (Chrome, Edge, Brave and others):** download the `chrome` zip from
  [Releases](https://github.com/Abhisek571/wordwarden/releases/latest), unzip it, open `chrome://extensions`,
  turn on Developer mode and choose **Load unpacked**. This copy does not update itself.
- **LibreOffice:** download the `libreoffice` file for your system (`windows`, `macos` or `linux`) from
  [Releases](https://github.com/Abhisek571/wordwarden/releases/latest) and double-click it, or open
  **Tools > Extension Manager** and choose **Add**, then restart LibreOffice. Settings are in
  **Tools > Options > Languages and Locales > Wordwarden**.

## How it works

- **Extension:** Manifest V3, built with [WXT](https://wxt.dev/) and React. A content script finds text
  boxes, draws the underlines and suggestion card in a closed shadow root, and applies a fix only when the
  user picks one.
- **One checker for all tabs:** the engine runs in the background script and every tab sends its text there,
  so extra tabs add little memory.
- **Engines:** [harper.js](https://github.com/Automattic/harper) for grammar, nspell with Hunspell
  dictionaries for spelling, a ranker that orders suggestions by edit cost, sound, word frequency and the
  surrounding words, and a few local rules.
- **LibreOffice add-on:** a Python UNO component that runs the same engine with a bundled Node.js.

| Folder | What is in it |
|---|---|
| `entrypoints/` | Background script, content script, popup, settings page and typing test |
| `src/engines/` | Spelling, grammar and ranking |
| `src/editors/` | Finding text boxes and applying fixes in text areas and rich editors |
| `src/ui/` | The underlines, suggestion card and status badge |
| `src/standalone/` | The engine host used by the LibreOffice add-on |
| `libreoffice/` | The LibreOffice add-on |
| `public/spelling/` | Bundled word lists and word-pair data |
| `scripts/` | Build, chart, benchmark and website scripts |
| `tests/` | Unit tests, browser tests and the Firefox smoke test |
| `website/` | The project website, filled with release notes and benchmark numbers by `scripts/build-website.mjs` |

## Development

Requires Node.js 22 or newer and npm 12 (`npm install -g npm@12.0.2`); the lock file is written by npm 12.

```sh
npm ci
npm run dev            # Chromium
npm run dev:firefox
```

Checks (the same ones run on GitHub for every push):

```sh
npm run compile
npm test
npm run build
npm run build:firefox
npm run lint:firefox
npm run test:firefox   # needs Firefox installed
npm run test:e2e
```

The browser tests need an open-source Chromium build, because branded Chrome and Edge 137+ block
command-line extension loading.

### Building the Firefox package from source

```sh
npm ci
npm run zip:firefox
```

The package is written to `.output/wordwarden-<version>-firefox.zip`, and the unpacked files to
`.output/firefox-mv3/`. `npm run zip` builds the Chromium package.

Release steps are in [docs/RELEASING.md](docs/RELEASING.md); benchmark method and test sets in
[docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Reporting a problem

Open Wordwarden's settings, choose **Report issue**, then **Generate diagnostic log** and **Copy log**.
**Open GitHub Issue** opens a new issue; pick **Bug report** and paste the log into it. The log holds browser
and extension details only, never your writing, and nothing is sent automatically. Security or privacy
problems: see [SECURITY.md](SECURITY.md).

See also: [privacy](docs/PRIVACY.md), [permissions](docs/PERMISSIONS.md),
[third-party notices](THIRD_PARTY_NOTICES.md) and the [changelog](CHANGELOG.md).

## License

Copyright (C) 2026 Wordwarden contributors. Licensed under the
[GNU General Public License v3.0](LICENSE).

For the licences of the open-source parts it includes, see [third-party notices](THIRD_PARTY_NOTICES.md).
