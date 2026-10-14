# Releasing

1. Add the version's section at the top of [CHANGELOG.md](../CHANGELOG.md) (`## 1.6.0 — YYYY-MM-DD` followed by
   `- ` bullets) and set the same version in `package.json`.
2. Push the commit, then push a version tag such as `v1.6.0`.

The tag starts these workflows:

- **Release** builds the Chromium and Firefox packages, the sources zip and the LibreOffice add-ons, tests the
  add-on in LibreOffice, and attaches everything to a GitHub release whose notes are the version's changelog
  section.
- **Accuracy** and **Resources** (for `vX.Y.0` tags only) rerun the benchmarks against the latest LanguageTool
  and commit the updated numbers and charts. Both can also be run by hand. Method and test sets:
  [BENCHMARKS.md](BENCHMARKS.md).
- **Website** rebuilds the [website](https://abhisek571.github.io/wordwarden/) from the changelog and the
  benchmark numbers whenever either changes.

Firefox Add-ons is updated by hand: upload `wordwarden-<version>-firefox.zip` and the sources zip from the
GitHub release.
