// Draws docs/accuracy.svg from a benchmark report written by `npm run evaluate:benchmarks`
// with WORDWARDEN_BENCHMARK_REPORT set. Usage: node scripts/accuracy-chart.mjs report.json
import { readFileSync, writeFileSync } from 'node:fs';

const [reportPath] = process.argv.slice(2);
if (reportPath === undefined) throw new TypeError('Expected the path of a benchmark report.');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Spelling sets share three bars. Holbrook has no tune/holdout split, so all of it is shown.
const SPELLING = [
  ['Typing test slips (Aalto)', report.aalto?.holdout],
  ['Tweets (LexNorm2015)', report.twitter?.holdout],
  ['Wikipedia misspellings', report.wikipedia?.holdout],
  ['Birkbeck (children, students)', report.birkbeck?.holdout],
  ['Children\'s writing (Holbrook)', report.holbrook?.taggedErrors],
].filter(([, rates]) => typeof rates?.detectedPct === 'number');
const SPELLING_BARS = [
  ['detectedPct', 'Caught', '#2f7d5b'],
  ['topOnePct', 'Correct word first', '#1e6fd9'],
  ['topThreePct', 'Correct word in top three', '#8fb3e8'],
];
const jfleg = report['jfleg-holdout'];
const GRAMMAR = jfleg?.learnerText === undefined ? [] : [
  ['Sentences with mistakes that get flagged', jfleg.learnerText.sentenceRecallPct, '#b45309'],
  ['Fixes that move the text closer to a human correction', jfleg.learnerText.fixPrecisionPct, '#e0a458'],
  ['Correct sentences wrongly flagged (lower is better)', jfleg.cleanText.flaggedSentencesPct, '#9a9893'],
];
if (SPELLING.length === 0) throw new Error('The report has no spelling results to draw.');

const ink = '#1d1d1b';
const muted = '#6b6a66';
const hair = '#e4e2dc';
const ground = '#fbfaf7';
const width = 800;
const left = 272;
const plotWidth = width - left - 64;
const barHeight = 14;
const barGap = 4;
const groupGap = 24;
const groupHeight = SPELLING_BARS.length * barHeight + (SPELLING_BARS.length - 1) * barGap;
const month = new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const parts = [];
const gridParts = [];
const x = (percent) => left + (percent / 100) * plotWidth;
const bar = (y, value, color) => {
  parts.push(`<rect x="${left}" y="${y}" width="${x(value) - left}" height="${barHeight}" rx="2" fill="${color}"/>`);
  parts.push(`<text x="${x(value) + 6}" y="${y + barHeight - 3}" font-size="11.5" font-weight="600" fill="${ink}">${value.toFixed(1)}%</text>`);
};
const grid = (top, bottom) => {
  for (const percent of [0, 25, 50, 75, 100]) {
    gridParts.push(`<line x1="${x(percent)}" y1="${top}" x2="${x(percent)}" y2="${bottom}" stroke="${hair}"/>`);
    gridParts.push(`<text x="${x(percent)}" y="${bottom + 16}" font-size="11" fill="${muted}" text-anchor="middle">${percent}%</text>`);
  }
};
// One legend item per line, so the spacing does not depend on the font the viewer has. Returns the next y.
const legend = (y, items) => {
  for (const [label, color] of items) {
    parts.push(`<rect x="${left}" y="${y - 10}" width="12" height="12" rx="2" fill="${color}"/>`);
    parts.push(`<text x="${left + 18}" y="${y}" font-size="12.5" fill="${ink}">${label}</text>`);
    y += 20;
  }
  return y;
};

let y = 92;
parts.push(`<text x="24" y="38" font-size="20" font-weight="700" fill="${ink}">Accuracy</text>`);
parts.push(`<text x="24" y="60" font-size="13" fill="${muted}">Held-out test data, not used for tuning · v${version} · ${month}</text>`);
parts.push(`<text x="24" y="${y}" font-size="14" font-weight="700" fill="${ink}">Spelling</text>`);
y += 18;
const spellingTop = y;
for (const [label, rates] of SPELLING) {
  parts.push(`<text x="${left - 14}" y="${y + groupHeight / 2 + 5}" font-size="14" font-weight="600" fill="${ink}" text-anchor="end">${label}</text>`);
  SPELLING_BARS.forEach(([field, , color], index) => bar(y + index * (barHeight + barGap), Number(rates[field]), color));
  y += groupHeight + groupGap;
}
grid(spellingTop - 8, y - groupGap + 8);
y = legend(y + 42, SPELLING_BARS.map(([, label, color]) => [label, color]));

if (GRAMMAR.length > 0) {
  y += 26;
  parts.push(`<text x="24" y="${y}" font-size="14" font-weight="700" fill="${ink}">Grammar</text>`);
  y += 18;
  const grammarTop = y;
  parts.push(`<text x="${left - 14}" y="${y + groupHeight / 2 + 5}" font-size="14" font-weight="600" fill="${ink}" text-anchor="end">Learner essays (JFLEG)</text>`);
  GRAMMAR.forEach(([, value, color], index) => bar(y + index * (barHeight + barGap), Number(value), color));
  y += groupHeight;
  grid(grammarTop - 8, y + 8);
  y = legend(y + 50, GRAMMAR.map(([label, , color]) => [label, color]));
}

const height = y + 6;
parts.unshift(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, system-ui, -apple-system, sans-serif" role="img" aria-label="Accuracy chart">`,
  `<rect width="100%" height="100%" rx="8" fill="${ground}"/>`,
  ...gridParts,
);
parts.push('</svg>');
writeFileSync(new URL('../docs/accuracy.svg', import.meta.url), `${parts.join('\n')}\n`);
console.log(`Wrote docs/accuracy.svg (${SPELLING.length} spelling sets, ${GRAMMAR.length > 0 ? 1 : 0} grammar set).`);
