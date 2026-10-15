// Fills website/index.html with the current release notes and benchmark numbers, so the page updates with
// each release. Reads CHANGELOG.md, docs/accuracy-history.json and docs/accuracy-latest.json, and rewrites
// the data block between the SITE DATA markers in the page.
// Usage: node scripts/build-website.mjs [page]   (default website/index.html)
import { readFileSync, writeFileSync } from 'node:fs';

const pagePath = process.argv[2] ?? 'website/index.html';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const readJson = (path) => JSON.parse(read(path));

// "## 1.5.2 — 2026-10-13" followed by "- " bullets; wrapped bullet lines are indented. Other paragraphs
// (such as a release's measurement summary) are left out, because the charts show those numbers.
function parseChangelog(text) {
  const releases = [];
  let current = null;
  for (const line of text.split(/\r?\n/u)) {
    const heading = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})/u.exec(line);
    if (heading) {
      current = { version: heading[1], date: heading[2], notes: [] };
      releases.push(current);
      continue;
    }
    if (current === null) continue;
    if (line.startsWith('- ')) current.notes.push(line.slice(2).trim());
    else if (/^\s{2,}\S/u.test(line) && current.notes.length > 0 && current.lastWasBullet) {
      current.notes[current.notes.length - 1] += ` ${line.trim()}`;
    }
    current.lastWasBullet = line.startsWith('- ') || (/^\s{2,}\S/u.test(line) && current.lastWasBullet);
  }
  return releases.map(({ version, date, notes }) => ({ version, date, notes: notes.map((note) => note.replace(/`([^`]+)`/gu, '$1')) }));
}

const parts = (version) => version.split('.').map(Number);
const compare = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

// One stamp per bigger release (x.y.0) plus the newest release. Each fix release folds into the bigger
// release it followed, or into the next stamp when there is none (such as 1.0.1).
function stamps(releases) {
  const sorted = [...releases].sort((a, b) => compare(a.version, b.version));
  const latest = sorted.at(-1);
  const isStamp = (release) => parts(release.version)[2] === 0 || release === latest;
  const result = sorted.filter(isStamp).map((release) => ({ ...release, fixes: [] }));
  for (const release of sorted.filter((candidate) => !isStamp(candidate))) {
    const [major, minor] = parts(release.version);
    const home = result.find((stamp) => parts(stamp.version)[0] === major && parts(stamp.version)[1] === minor && parts(stamp.version)[2] === 0)
      ?? result.find((stamp) => compare(stamp.version, release.version) > 0);
    if (home === undefined) continue;
    home.fixes.push([release.version, release.notes.map((note) => note.replace(/\*\*/gu, '')).join(' ')]);
  }
  return result.map(({ version, date, notes, fixes }) => [version, date, notes, fixes]);
}

const site = {
  releases: stamps(parseChangelog(read('CHANGELOG.md'))),
  history: readJson('docs/accuracy-history.json').rows,
  accuracy: readJson('docs/accuracy-latest.json'),
};

const page = readFileSync(pagePath, 'utf8');
const start = '/* SITE DATA: written by scripts/build-website.mjs */';
const end = '/* END SITE DATA */';
const from = page.indexOf(start);
const to = page.indexOf(end);
if (from < 0 || to < from) throw new Error(`${pagePath} has no SITE DATA block.`);
const block = `${start}\nconst SITE = ${JSON.stringify(site, null, 1)};\n`;
writeFileSync(pagePath, page.slice(0, from) + block + page.slice(to));
process.stdout.write(`Wrote ${pagePath}: ${site.releases.length} release stamps, ${site.history.length} measured releases, accuracy ${site.accuracy.version}.\n`);
