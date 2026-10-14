// Saves the numbers the website shows from a benchmark run, next to the charts the same run draws.
// Usage: node scripts/website-numbers.mjs accuracy <report.json>   (writes docs/accuracy-latest.json)
//        node scripts/website-numbers.mjs resources <resources.json> (writes docs/resources-latest.json)
// The version is the one in package.json, as for the accuracy history.
import { readFileSync, writeFileSync } from 'node:fs';

const [kind, reportPath] = process.argv.slice(2);
if (!['accuracy', 'resources'].includes(kind) || reportPath === undefined) {
  throw new Error('Usage: node scripts/website-numbers.mjs <accuracy|resources> <report.json>');
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const round = (value) => (typeof value === 'number' ? Math.round(value * 10) / 10 : null);

function accuracy() {
  const lt = report.languagetool ?? {};
  // Holbrook has no tune/holdout split, so all of it is used, as in the accuracy chart.
  const spellingSet = (name, part) => ({
    caught: round(report[name]?.[part]?.detectedPct),
    topOne: round(report[name]?.[part]?.topOnePct),
    topThree: round(report[name]?.[part]?.topThreePct),
    languageTool: round(lt[name]?.[part]?.topOnePct),
  });
  const jfleg = report['jfleg-holdout'];
  const ltJfleg = lt['jfleg-holdout'];
  return {
    version,
    date: new Date().toISOString().slice(0, 10),
    languageToolVersion: typeof lt.version === 'string' ? lt.version : null,
    spelling: {
      aalto: spellingSet('aalto', 'holdout'),
      twitter: spellingSet('twitter', 'holdout'),
      wikipedia: spellingSet('wikipedia', 'holdout'),
      birkbeck: spellingSet('birkbeck', 'holdout'),
      holbrook: spellingSet('holbrook', 'taggedErrors'),
    },
    grammar: {
      fixes: { wordwarden: round(jfleg?.learnerText?.fixPrecisionPct), languageTool: round(ltJfleg?.learnerText?.fixPrecisionPct) },
      falseAlarms: { wordwarden: round(jfleg?.cleanText?.flaggedSentencesPct), languageTool: round(ltJfleg?.cleanText?.flaggedSentencesPct) },
      recall: { wordwarden: round(jfleg?.learnerText?.sentenceRecallPct), languageTool: round(ltJfleg?.learnerText?.sentenceRecallPct) },
    },
  };
}

function resources() {
  const ours = report.wordwarden ?? {};
  const theirs = report.languageTool ?? {};
  return {
    version,
    date: String(report.measuredAt ?? new Date().toISOString()).slice(0, 10),
    words: report.words,
    tabs: ours.manyTabs,
    wordwarden: {
      oneTabMb: Math.round(ours.oneTabMb), manyTabsMb: Math.round(ours.manyTabsMb), startCpuS: round(ours.startCpu),
      checkCpuMs: Math.round(ours.checkCpuMs), checkMs: Math.round(ours.checkMs), diskMb: Math.round(ours.diskMb),
    },
    languageTool: {
      memoryMb: Math.round(theirs.memoryMb), startCpuS: round(theirs.startCpu),
      checkCpuMs: Math.round(theirs.checkCpuMs), checkMs: Math.round(theirs.checkMs), diskMb: Math.round(theirs.diskMb),
    },
  };
}

const output = kind === 'accuracy' ? 'docs/accuracy-latest.json' : 'docs/resources-latest.json';
writeFileSync(output, `${JSON.stringify(kind === 'accuracy' ? accuracy() : resources(), null, 2)}\n`);
process.stdout.write(`Wrote ${output}\n`);
