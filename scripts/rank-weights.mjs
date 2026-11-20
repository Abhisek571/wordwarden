// Fits the spelling ranker's weights (RANK_WEIGHTS in src/engines/spelling-ranker.ts) on the tune halves of the
// spelling benchmarks and prints them. Make the input with:
//   WORDWARDEN_BENCHMARK_RANK_CASES=rank-cases.jsonl WORDWARDEN_BENCHMARK_COMPARE=0 npm run evaluate:benchmarks
// which writes, for every tune-half misspelling the ranker saw, each candidate with its signals (the holdout halves
// are never written). The score of each weight set is the share of right words ranked first, plus a quarter of the
// share in the first three, averaged over the four sets so each counts the same. From several starting points, each
// weight is moved up and down in turn while the score rises, with smaller steps once none does; the best is kept.
// Usage: node scripts/rank-weights.mjs <rank-cases.jsonl>
import { readFileSync } from 'node:fs';

const NAMES = Object.freeze([
  'frequency', 'commonTypo', 'keySlip', 'endingMatch', 'byEar', 'slip', 'context', 'droppedG',
  'twoEdits', 'threeEdits', 'moreEdits',
]);
// Where each run starts. The first fit started from the old hand-set multipliers (a left-out or swapped letter ×100,
// a slipped finger or kept ending ×10, a word that sounds right ×2, in powers of two); these are its result.
const START = Object.freeze({
  frequency: 2, commonTypo: 12.19, keySlip: 4.4, endingMatch: 5.76, byEar: 2.92, slip: 1.95, context: 1,
  droppedG: 8,
});
const DISTANCE_STARTS = Object.freeze({ twoEdits: [-10, -16], threeEdits: [-20, -26, -32], moreEdits: [-30, -40] });
const DROPPED_G_STARTS = Object.freeze([0, 8]);
const TIER_GAP = 1e6;
// Weights set by hand, not fitted (see RANK_WEIGHTS): the personal-word weight.
const FIXED = Object.freeze({ personal: 16 });

const [casesPath] = process.argv.slice(2);
if (casesPath === undefined) {
  console.error('Usage: node scripts/rank-weights.mjs <rank-cases.jsonl>');
  process.exit(1);
}

/** Every candidate of every case in flat arrays, so one weight set is scored in a single pass. */
function readCases(path) {
  const sets = [];
  const caseSet = [];
  const caseStart = [];
  const signals = [];
  const tiers = [];
  const isTarget = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const item = JSON.parse(line);
    if (item.candidates.length === 0) continue;
    if (!sets.includes(item.set)) sets.push(item.set);
    caseSet.push(sets.indexOf(item.set));
    caseStart.push(tiers.length);
    const wanted = new Set(item.targets);
    for (const candidate of item.candidates) {
      for (const name of NAMES) signals.push(candidate.signals[name] ?? 0);
      let fixed = 0;
      for (const [name, weight] of Object.entries(FIXED)) fixed += weight * (candidate.signals[name] ?? 0);
      tiers.push(candidate.tier * TIER_GAP + fixed);
      isTarget.push(wanted.has(candidate.word.toLocaleLowerCase('en')));
    }
  }
  caseStart.push(tiers.length);
  const totals = sets.map((_, index) => caseSet.filter((set) => set === index).length);
  return { sets, caseSet, caseStart, signals: Float64Array.from(signals), tiers, isTarget, totals };
}

function rates(cases, weights) {
  const topOne = cases.sets.map(() => 0);
  const topThree = cases.sets.map(() => 0);
  const scores = new Float64Array(cases.tiers.length);
  for (let row = 0; row < scores.length; row += 1) {
    let score = cases.tiers[row];
    for (let column = 0; column < NAMES.length; column += 1) score += weights[column] * cases.signals[row * NAMES.length + column];
    scores[row] = score;
  }
  for (let item = 0; item < cases.caseSet.length; item += 1) {
    const from = cases.caseStart[item];
    const to = cases.caseStart[item + 1];
    let best = -Infinity;
    for (let row = from; row < to; row += 1) if (cases.isTarget[row] && scores[row] > best) best = scores[row];
    if (best === -Infinity) continue;
    let better = 0;
    for (let row = from; row < to; row += 1) if (!cases.isTarget[row] && scores[row] > best) better += 1;
    if (better === 0) topOne[cases.caseSet[item]] += 1;
    if (better < 3) topThree[cases.caseSet[item]] += 1;
  }
  return cases.sets.map((set, index) => ({
    set, topOne: topOne[index] / cases.totals[index], topThree: topThree[index] / cases.totals[index],
  }));
}

function objective(cases, weights) {
  const perSet = rates(cases, weights);
  return perSet.reduce((sum, rate) => sum + rate.topOne + 0.25 * rate.topThree, 0) / perSet.length;
}

function descend(cases, start) {
  let weights = [...start];
  let best = objective(cases, weights);
  const steps = NAMES.map((name) => (name.endsWith('Edits') ? 4 : 1));
  while (Math.max(...steps) >= 0.05) {
    let improved = false;
    for (let index = 0; index < NAMES.length; index += 1) {
      for (const direction of [1, -1]) {
        for (;;) {
          const trial = [...weights];
          trial[index] += direction * steps[index];
          const value = objective(cases, trial);
          if (value <= best + 1e-6) break;
          weights = trial;
          best = value;
          improved = true;
        }
      }
    }
    if (!improved) for (let index = 0; index < steps.length; index += 1) steps[index] /= 2;
  }
  return { weights, best };
}

const cases = readCases(casesPath);
console.log(`${cases.caseSet.length} cases: ${cases.sets.map((set, index) => `${set} ${cases.totals[index]}`).join(', ')}`);
let fitted = null;
for (const twoEdits of DISTANCE_STARTS.twoEdits) {
  for (const threeEdits of DISTANCE_STARTS.threeEdits) {
    for (const moreEdits of DISTANCE_STARTS.moreEdits) {
      for (const droppedG of DROPPED_G_STARTS) {
        const start = { ...START, droppedG, twoEdits, threeEdits, moreEdits };
        const result = descend(cases, NAMES.map((name) => start[name]));
        if (fitted === null || result.best > fitted.best) fitted = result;
      }
    }
  }
}
for (const rate of rates(cases, fitted.weights)) {
  console.log(`${rate.set}: first ${(rate.topOne * 100).toFixed(1)}%, top three ${(rate.topThree * 100).toFixed(1)}%`);
}
console.log(JSON.stringify(Object.fromEntries(NAMES.map((name, index) => [name, Math.round(fitted.weights[index] * 100) / 100]))));
