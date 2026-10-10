// Draws docs/accuracy.svg from a benchmark report written by `npm run evaluate:benchmarks`
// with WORDWARDEN_BENCHMARK_REPORT set. Usage: node scripts/accuracy-chart.mjs report.json
import { readFileSync, writeFileSync } from 'node:fs';

const [reportPath] = process.argv.slice(2);
if (reportPath === undefined) throw new TypeError('Expected the path of a benchmark report.');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const SETS = [
  ['aalto', 'Typing test slips (Aalto)'],
  ['twitter', 'Tweets (LexNorm2015)'],
  ['wikipedia', 'Wikipedia misspellings'],
  ['birkbeck', 'Birkbeck (children, students)'],
];
const BARS = [
  ['detectedPct', 'Caught', '#2f7d5b'],
  ['topOnePct', 'Right word first', '#1e6fd9'],
  ['topThreePct', 'Right word in top three', '#8fb3e8'],
];
const sets = SETS.filter(([key]) => typeof report[key]?.holdout?.detectedPct === 'number');
if (sets.length === 0) throw new Error('The report has no spelling results to draw.');

const ink = '#1d1d1b';
const muted = '#6b6a66';
const hair = '#e4e2dc';
const ground = '#fbfaf7';
const width = 760;
const left = 230;
const plotWidth = width - left - 60;
const barHeight = 14;
const barGap = 4;
const groupGap = 26;
const top = 92;
const groupHeight = BARS.length * barHeight + (BARS.length - 1) * barGap;
const height = top + sets.length * (groupHeight + groupGap) + 74;
const month = new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, system-ui, -apple-system, sans-serif" role="img" aria-label="Spelling accuracy chart">`,
  `<rect width="100%" height="100%" rx="8" fill="${ground}"/>`,
  `<text x="24" y="38" font-size="20" font-weight="700" fill="${ink}">Spelling accuracy</text>`,
  `<text x="24" y="60" font-size="13" fill="${muted}">Held-out test data, not used for tuning · v${version} · ${month}</text>`,
];
for (const percent of [0, 25, 50, 75, 100]) {
  const x = left + (percent / 100) * plotWidth;
  parts.push(`<line x1="${x}" y1="${top - 8}" x2="${x}" y2="${height - 62}" stroke="${hair}"/>`);
  parts.push(`<text x="${x}" y="${height - 46}" font-size="11" fill="${muted}" text-anchor="middle">${percent}%</text>`);
}
sets.forEach(([key, label], index) => {
  const groupTop = top + index * (groupHeight + groupGap);
  parts.push(`<text x="${left - 14}" y="${groupTop + groupHeight / 2 + 5}" font-size="14" font-weight="600" fill="${ink}" text-anchor="end">${label}</text>`);
  BARS.forEach(([field, , color], bar) => {
    const value = Number(report[key].holdout[field]);
    const y = groupTop + bar * (barHeight + barGap);
    const barWidth = (value / 100) * plotWidth;
    parts.push(`<rect x="${left}" y="${y}" width="${barWidth}" height="${barHeight}" rx="2" fill="${color}"/>`);
    parts.push(`<text x="${left + barWidth + 6}" y="${y + barHeight - 3}" font-size="11.5" font-weight="600" fill="${ink}">${value.toFixed(1)}%</text>`);
  });
});
let legendX = left;
for (const [, label, color] of BARS) {
  parts.push(`<rect x="${legendX}" y="${height - 26}" width="12" height="12" rx="2" fill="${color}"/>`);
  parts.push(`<text x="${legendX + 18}" y="${height - 16}" font-size="12.5" fill="${ink}">${label}</text>`);
  legendX += 36 + label.length * 7;
}
parts.push('</svg>');
writeFileSync(new URL('../docs/accuracy.svg', import.meta.url), `${parts.join('\n')}\n`);
console.log(`Wrote docs/accuracy.svg (${sets.length} test sets).`);
