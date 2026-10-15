import type { WordPairs } from '#/engines/word-pairs';

// Real words often typed for one another that the core has no rule for (it already covers there/their/
// they're, then/than, to/too, were/where, its/it's, your/you're, quite/quiet, lose/loose and
// weather/whether). A word is flagged only when the words either side fit the other member far better.
const CONFUSION_SETS: readonly (readonly string[])[] = Object.freeze([
  ['form', 'from'], ['of', 'off'], ['accept', 'except'], ['advice', 'advise'], ['lead', 'led'],
  ['no', 'know'], ['now', 'not'], ['our', 'are'], ['ate', 'eat'], ['bean', 'been'],
  ['affect', 'effect'], ['loss', 'lose'], ['chose', 'choose'], ['cloths', 'clothes'],
  ['breath', 'breathe'], ['passed', 'past'], ['by', 'buy'], ['new', 'knew'], ['hear', 'here'],
  ['week', 'weak'], ['peace', 'piece'], ['whole', 'hole'], ['you', 'your'], ['life', 'live'],
  ['though', 'through', 'thought'], ['want', 'went'], ['with', 'which'],
].map((set) => Object.freeze(set)));

const ALTERNATIVES: ReadonlyMap<string, readonly string[]> = new Map(
  CONFUSION_SETS.flatMap((set) => set.map((word) => [word, set.filter((other) => other !== word)] as const)),
);

// The other word must be at least this much likelier from both neighbours together, and each of the
// original's pairs must be rare in news text while each of the alternative's is common.
const EVIDENCE_RATIO = 20;
const RARE_PAIR = 100;
const COMMON_PAIR = 20;
const SMOOTHING = 100;

/** The chance of seeing these neighbours around the word, from how much of the word's use they make up. */
function evidence(pairs: WordPairs, previous: string, word: string, next: string): number {
  const total = pairs.wordCount(word) + SMOOTHING;
  return ((pairs.pairCount(previous, word) + 1) / total) * ((pairs.pairCount(word, next) + 1) / total);
}

function preserveCase(source: string, replacement: string): string {
  if (source === source.toLocaleUpperCase('en')) return replacement.toLocaleUpperCase('en');
  const first = source[0];
  if (first === undefined || first === first.toLocaleLowerCase('en')) return replacement;
  return `${replacement.slice(0, 1).toLocaleUpperCase('en')}${replacement.slice(1)}`;
}

export type ConfusedWord = Readonly<{ start: number; end: number; original: string; replacement: string }>;

/** Words from the confusion sets whose neighbours clearly belong to another member of the set. */
export function findConfusedWords(text: string, pairs: WordPairs): readonly ConfusedWord[] {
  const found: ConfusedWord[] = [];
  const tokens = [...text.matchAll(/[\p{L}'’]+/gu)].map((match) => Object.freeze({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    text: match[0],
    word: match[0].toLocaleLowerCase('en').replaceAll('’', "'"),
  }));
  tokens.forEach((token, index) => {
    const alternatives = ALTERNATIVES.get(token.word);
    const before = tokens[index - 1];
    const after = tokens[index + 1];
    if (alternatives === undefined || before === undefined || after === undefined) return;
    // Only plain spaces may separate the three words: a comma or full stop breaks the pair.
    if (!/^\s+$/u.test(text.slice(before.end, token.start)) || !/^\s+$/u.test(text.slice(token.end, after.start))) return;
    if (pairs.wordCount(before.word) === 0 || pairs.wordCount(after.word) === 0) return;
    if (pairs.pairCount(before.word, token.word) > RARE_PAIR || pairs.pairCount(token.word, after.word) > RARE_PAIR) return;
    const original = evidence(pairs, before.word, token.word, after.word);
    const best = alternatives
      .filter((word) => pairs.pairCount(before.word, word) >= COMMON_PAIR && pairs.pairCount(word, after.word) >= COMMON_PAIR)
      .map((word) => Object.freeze({ word, evidence: evidence(pairs, before.word, word, after.word) }))
      .sort((left, right) => right.evidence - left.evidence)[0];
    if (best === undefined || best.evidence < EVIDENCE_RATIO * original) return;
    found.push(Object.freeze({
      start: token.start, end: token.end, original: token.text, replacement: preserveCase(token.text, best.word),
    }));
  });
  return Object.freeze(found);
}
