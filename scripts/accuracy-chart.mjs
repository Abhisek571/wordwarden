// Draws docs/accuracy.svg from a benchmark report written by `npm run evaluate:benchmarks`
// with WORDWARDEN_BENCHMARK_REPORT set. Usage: node scripts/accuracy-chart.mjs report.json [out.svg]
import { readFileSync, writeFileSync } from 'node:fs';

const [reportPath, outArg] = process.argv.slice(2);
if (reportPath === undefined) throw new TypeError('Expected the path of a benchmark report.');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const other = report.languagetool;
// Harper on its own, as the harper.js package ships it.
const harper = report.harper;

const BLUE = '#1e6fd9';
const GREY = '#9a9893';
const TEAL = '#2a9d8f';
// Spelling sets share three bars, plus LanguageTool's "correct word first" when the report has it.
// Holbrook has no tune/holdout split, so all of it is shown.
const SPELLING = [
  ['Typing test slips', report.aalto?.holdout, other?.aalto?.holdout, harper?.aalto?.holdout],
  ['Tweets', report.twitter?.holdout, other?.twitter?.holdout, harper?.twitter?.holdout],
  ['Wikipedia edits', report.wikipedia?.holdout, other?.wikipedia?.holdout, harper?.wikipedia?.holdout],
  ['Children and students', report.birkbeck?.holdout, other?.birkbeck?.holdout, harper?.birkbeck?.holdout],
  ['Children\'s writing', report.holbrook?.taggedErrors, other?.holbrook?.taggedErrors, harper?.holbrook?.taggedErrors],
].filter(([, rates]) => typeof rates?.detectedPct === 'number');
const SPELLING_BARS = [
  ['detectedPct', 'Caught', '#2f7d5b'],
  ['topOnePct', 'Correct word first', BLUE],
  ['topThreePct', 'Correct word in top three', '#8fb3e8'],
];
const jfleg = report['jfleg-holdout'];
const jflegOther = other?.['jfleg-holdout'];
const jflegHarper = harper?.['jfleg-holdout'];
// [label, value, colour, LanguageTool's value for the same measure, note after the value, Harper's value]
const GRAMMAR = jfleg?.learnerText === undefined ? [] : [
  ['Sentences with mistakes that get flagged', jfleg.learnerText.sentenceRecallPct, '#b45309', undefined, '', jflegHarper?.learnerText?.sentenceRecallPct],
  ['Fixes that move the text closer to a human correction', jfleg.learnerText.fixPrecisionPct, '#e0a458', jflegOther?.learnerText?.fixPrecisionPct, '', jflegHarper?.learnerText?.fixPrecisionPct],
  ['Correct sentences wrongly flagged', jfleg.cleanText.flaggedSentencesPct, '#8a8884', jflegOther?.cleanText?.flaggedSentencesPct, 'lower is better', jflegHarper?.cleanText?.flaggedSentencesPct],
];
if (SPELLING.length === 0) throw new Error('The report has no spelling results to draw.');
const hasOther = SPELLING.some(([, , theirs]) => typeof theirs?.topOnePct === 'number')
  || GRAMMAR.some(([, , , theirs]) => typeof theirs === 'number');
const hasHarper = SPELLING.some(([, , , plain]) => typeof plain?.topOnePct === 'number');

const ink = '#1d1d1b';
const muted = '#6b6a66';
const hair = '#e4e2dc';
const ground = '#fbfaf7';
const width = 800;
const left = 240;
const plotWidth = width - left - 64;
const barHeight = 14;
const barGap = 4;
const groupGap = 24;
const parts = [];
const gridParts = [];
const x = (percent) => left + (percent / 100) * plotWidth;
const bar = (y, value, color, note = '') => {
  parts.push(`<rect x="${left}" y="${y}" width="${x(value) - left}" height="${barHeight}" rx="2" fill="${color}"/>`);
  parts.push(`<text x="${x(value) + 6}" y="${y + barHeight - 3}" font-size="11.5" font-weight="600" fill="${ink}">${value.toFixed(1)}%${note ? `<tspan font-weight="400" fill="${muted}"> ${note}</tspan>` : ''}</text>`);
  return y + barHeight + barGap;
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
const rowLabel = (top, bottom, label) => {
  parts.push(`<text x="${left - 14}" y="${(top + bottom) / 2 + 5}" font-size="14" font-weight="600" fill="${ink}" text-anchor="end">${label}</text>`);
};
const otherLegend = [
  ...(hasOther ? [['LanguageTool, same measure', GREY]] : []),
  ...(hasHarper ? [['Harper alone, same measure', TEAL]] : []),
];

let y = 92;
parts.push(`<text x="24" y="38" font-size="20" font-weight="700" fill="${ink}">Accuracy</text>`);
parts.push(`<text x="24" y="60" font-size="13" fill="${muted}">Held-out test data, not used for tuning. Grey: LanguageTool, latest version, default setup. Teal: Harper alone, as harper.js ships it.</text>`);
parts.push(`<text x="24" y="${y}" font-size="14" font-weight="700" fill="${ink}">Spelling</text>`);
y += 18;
const spellingTop = y;
for (const [label, rates, theirs, plain] of SPELLING) {
  const top = y;
  for (const [field, , color] of SPELLING_BARS) {
    y = bar(y, Number(rates[field]), color);
    // LanguageTool's bar sits right under the one it compares with.
    if (field === 'topOnePct' && typeof theirs?.topOnePct === 'number') y = bar(y, Number(theirs.topOnePct), GREY);
    if (field === 'topOnePct' && typeof plain?.topOnePct === 'number') y = bar(y, Number(plain.topOnePct), TEAL);
  }
  rowLabel(top, y - barGap, label);
  y += groupGap - barGap;
}
grid(spellingTop - 8, y - groupGap + barGap + 8);
y = legend(y + 42, [...SPELLING_BARS.map(([, label, color]) => [label, color]), ...otherLegend]);

if (GRAMMAR.length > 0) {
  y += 26;
  parts.push(`<text x="24" y="${y}" font-size="14" font-weight="700" fill="${ink}">Grammar</text>`);
  y += 18;
  const grammarTop = y;
  for (const [, value, color, theirs, note, plain] of GRAMMAR) {
    y = bar(y, Number(value), color, note);
    if (typeof theirs === 'number') y = bar(y, Number(theirs), GREY);
    if (typeof plain === 'number') y = bar(y, Number(plain), TEAL);
  }
  rowLabel(grammarTop, y - barGap, 'Learner essays');
  grid(grammarTop - 8, y - barGap + 8);
  y = legend(y + 46, [...GRAMMAR.map(([label, , color]) => [label, color]), ...otherLegend]);
}

y += 14;
parts.push(`<line x1="24" y1="${y}" x2="${width - 24}" y2="${y}" stroke="${hair}"/>`);
y += 22;
parts.push(`<text x="24" y="${y}" font-size="12" fill="${muted}">Test sets: the Aalto typing test, LexNorm2015 tweets, Wikipedia edit history, the Birkbeck spelling lists, Holbrook's children's writing</text>`);
y += 18;
parts.push(`<text x="24" y="${y}" font-size="12" fill="${muted}">and JFLEG learner essays. Details and credits in docs/BENCHMARKS.md. Generated automatically for every release except small bug fixes.</text>`);
const height = y + 18;
parts.unshift(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, system-ui, -apple-system, sans-serif" role="img" aria-label="Accuracy chart">`,
  `<rect width="100%" height="100%" rx="8" fill="${ground}"/>`,
  ...gridParts,
);
parts.push('</svg>');
writeFileSync(outArg ?? new URL('../docs/accuracy.svg', import.meta.url), `${parts.join('\n')}\n`);
console.log(`Wrote ${outArg ?? 'docs/accuracy.svg'} (${SPELLING.length} spelling sets, ${GRAMMAR.length > 0 ? 1 : 0} grammar set).`);
