// Keeps docs/accuracy-history.json, one row per release, and draws docs/accuracy-history.svg: one line
// per measure across releases, labelled at the right with the newest value and the change since the
// previous release. Wordwarden only; the comparison with LanguageTool is in docs/accuracy.svg.
// Usage: node scripts/accuracy-history.mjs [report.json] [history.json] [out.svg]
// With a report (from `npm run evaluate:benchmarks` with WORDWARDEN_BENCHMARK_REPORT set), the row for
// the version in package.json is added or replaced first. Without one, the chart is only redrawn.
import { readFileSync, writeFileSync } from 'node:fs';

const [reportPath, historyArg, outArg] = process.argv.slice(2);
const historyPath = historyArg ?? new URL('../docs/accuracy-history.json', import.meta.url);
const outPath = outArg ?? new URL('../docs/accuracy-history.svg', import.meta.url);

// Which report fields each row keeps: the same measures as the bars in docs/accuracy.svg. Spelling sets
// get a blue-to-teal run, grammar the warm colours, and false alarms grey because lower is better there.
const MEASURES = [
  ['wikipedia', 'Wikipedia edits', '#1e6fd9', (r) => r.wikipedia?.holdout?.topOnePct],
  ['twitter', 'Tweets (LexNorm2015)', '#3b8ed0', (r) => r.twitter?.holdout?.topOnePct],
  ['aalto', 'Typing test slips (Aalto)', '#2f9e9a', (r) => r.aalto?.holdout?.topOnePct],
  ['birkbeck', 'Children and students (Birkbeck)', '#2f7d5b', (r) => r.birkbeck?.holdout?.topOnePct],
  ['holbrook', 'Children\'s writing (Holbrook)', '#7a9a3a', (r) => r.holbrook?.taggedErrors?.topOnePct],
  ['recall', 'Mistakes caught (JFLEG)', '#b45309', (r) => r['jfleg-holdout']?.learnerText?.sentenceRecallPct],
  ['fixes', 'Helpful fixes (JFLEG)', '#e0a458', (r) => r['jfleg-holdout']?.learnerText?.fixPrecisionPct],
  ['falseAlarms', 'False alarms (JFLEG)', '#8a8884', (r) => r['jfleg-holdout']?.cleanText?.flaggedSentencesPct, true],
];

const history = JSON.parse(readFileSync(historyPath, 'utf8'));
if (!Array.isArray(history.rows)) throw new TypeError('The history file needs a "rows" array.');

if (reportPath) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const pick = (source) => Object.fromEntries(
    MEASURES.map(([key, , , read]) => [key, read(source)]).filter(([, value]) => typeof value === 'number'),
  );
  const row = { version: `v${version}`, date: new Date().toISOString().slice(0, 10), wordwarden: pick(report) };
  const index = history.rows.findIndex((existing) => existing.version === row.version);
  if (index === -1) history.rows.push(row);
  else history.rows[index] = row;
  writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);
}

const rows = history.rows;
if (rows.length === 0) throw new Error('The history has no rows to draw.');

const ink = '#1d1d1b';
const muted = '#6b6a66';
const hair = '#e4e2dc';
const ground = '#fbfaf7';
const good = '#2f7d5b';
const bad = '#b42318';
const width = 800;
const left = 64;
const right = width - 330;
const top = 96;
const plotHeight = 400;
const bottom = top + plotHeight;
const plotWidth = right - left;
const parts = [];

const yFor = (value) => bottom - (value / 100) * plotHeight;
// The plot is always the same size: the first release at the left edge, the newest at the right edge,
// and the releases between them spread evenly.
const xFor = (i) => (rows.length === 1 ? left : left + (i / (rows.length - 1)) * plotWidth);
const path = (points) => points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

parts.push(`<text x="24" y="38" font-size="20" font-weight="700" fill="${ink}">Accuracy over releases</text>`);
parts.push(`<text x="24" y="60" font-size="13" fill="${muted}">Held-out test data, not used for tuning. Spelling sets: how often the correct word is the first suggestion.</text>`);

for (const percent of [0, 25, 50, 75, 100]) {
  parts.push(`<line x1="${left}" y1="${yFor(percent)}" x2="${right}" y2="${yFor(percent)}" stroke="${hair}"/>`);
  parts.push(`<text x="${left - 10}" y="${yFor(percent) + 4}" font-size="11" fill="${muted}" text-anchor="end">${percent}%</text>`);
}
rows.forEach((row, i) => {
  parts.push(`<line x1="${xFor(i)}" y1="${top}" x2="${xFor(i)}" y2="${bottom}" stroke="${hair}" stroke-dasharray="2 4"/>`);
  parts.push(`<text x="${xFor(i).toFixed(1)}" y="${bottom + 18}" font-size="11.5" font-weight="600" fill="${ink}" text-anchor="middle">${row.version}</text>`);
  parts.push(`<text x="${xFor(i).toFixed(1)}" y="${bottom + 33}" font-size="10.5" fill="${muted}" text-anchor="middle">${row.date}</text>`);
});

// Every line ends in a label. Labels that would sit on top of each other are nudged apart, and a thin
// connector shows which point a moved label belongs to.
const labels = [];
for (const [key, name, color, , lowerIsBetter] of MEASURES) {
  const points = rows.map((row, i) => [xFor(i), row.wordwarden[key]]).filter(([, value]) => typeof value === 'number');
  if (points.length === 0) continue;
  const placed = points.map(([x, value]) => [x, yFor(value), value]);
  const dash = lowerIsBetter ? ' stroke-dasharray="6 4"' : '';
  if (placed.length > 1) parts.push(`<path d="${path(placed)}" fill="none" stroke="${color}" stroke-width="2.25"${dash}/>`);
  for (const [x, y] of placed) parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.75" fill="${color}"/>`);
  const [, lastY, lastValue] = placed[placed.length - 1];
  const previous = placed.length > 1 ? placed[placed.length - 2][2] : lastValue;
  const change = lastValue - previous;
  const improved = lowerIsBetter ? change < 0 : change > 0;
  labels.push({ name, color, y: lastY, pointY: lastY, value: lastValue, change, improved });
}
labels.sort((a, b) => a.y - b.y);
const gap = 17;
for (let i = 1; i < labels.length; i += 1) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + gap);
for (let i = labels.length - 1; i >= 0; i -= 1) {
  const limit = i === labels.length - 1 ? bottom : labels[i + 1].y - gap;
  labels[i].y = Math.min(labels[i].y, limit);
}
// The labels have a fixed column at the right: value, name, change from the previous release.
const labelX = right + 30;
for (const label of labels) {
  if (Math.abs(label.y - label.pointY) > 1) {
    parts.push(`<path d="M${right + 8} ${label.pointY.toFixed(1)} H${right + 14} L${labelX - 6} ${label.y.toFixed(1)}" fill="none" stroke="${label.color}" stroke-width="1" opacity="0.5"/>`);
  }
  const y = label.y + 4;
  // The change from the previous release follows the value in brackets, green when it improved, red when
  // it got worse, grey when it stayed the same.
  let change = '';
  if (rows.length > 1) {
    const same = Math.abs(label.change) < 0.05;
    const sign = same ? '±' : label.change > 0 ? '+' : '−';
    const tone = same ? muted : label.improved ? good : bad;
    change = `<tspan font-size="11.5" fill="${tone}"> (${sign}${Math.abs(label.change).toFixed(1)})</tspan>`;
  }
  parts.push(`<text x="${labelX}" y="${y.toFixed(1)}" font-size="12.5" font-weight="600" fill="${ink}">${label.value.toFixed(1)}%${change}</text>`);
  parts.push(`<text x="${labelX + (rows.length > 1 ? 94 : 46)}" y="${y.toFixed(1)}" font-size="12" fill="${label.color}">${label.name}</text>`);
}

let y = bottom + 58;
parts.push(`<line x1="24" y1="${y}" x2="${width - 24}" y2="${y}" stroke="${hair}"/>`);
y += 22;
parts.push(`<text x="24" y="${y}" font-size="12" fill="${muted}">In brackets: the change from the previous release, green when better, red when worse. Dashed line: lower is better.</text>`);
y += 17;
parts.push(`<text x="24" y="${y}" font-size="12" fill="${muted}">Generated automatically for every release except small bug fixes.</text>`);
const height = y + 20;
parts.unshift(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, system-ui, -apple-system, sans-serif" role="img" aria-label="Accuracy over releases">`,
  `<rect width="100%" height="100%" rx="8" fill="${ground}"/>`,
);
parts.push('</svg>');
writeFileSync(outPath, `${parts.join('\n')}\n`);
console.log(`Wrote ${outArg ?? 'docs/accuracy-history.svg'} (${rows.length} release${rows.length === 1 ? '' : 's'}).`);
