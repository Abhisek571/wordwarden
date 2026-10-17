import { issueHash } from '#/core/hash';
import type { IssueCategory, WritingIssue } from '#/core/types';
import { findConfusedWords } from '#/engines/confused-words';
import { EMPTY_WORD_PAIRS, type WordPairs } from '#/engines/word-pairs';

const COMPOUND_SUBJECT_VERBS = Object.freeze(
  new Map([
    ['was', 'were'],
    ['is', 'are'],
    ['has', 'have'],
    ['does', 'do'],
  ]),
);

const PLURAL_SUBJECT_VERBS = Object.freeze(
  new Map([
    ...COMPOUND_SUBJECT_VERBS,
    ["doesn't", "don't"],
    ['doesn’t', 'don’t'],
  ]),
);

const INDEFINITE_SUBJECT_VERBS = Object.freeze(
  new Map<string, readonly [string, string]>([
    ['tell', ['tells', 'told']],
    ['say', ['says', 'said']],
    ['go', ['goes', 'went']],
    ['know', ['knows', 'knew']],
    ['want', ['wants', 'wanted']],
    ['need', ['needs', 'needed']],
  ]),
);

const NON_SINGULAR_NOUNS = new Set([
  'cattle',
  'children',
  'clergy',
  'elderly',
  'few',
  'i',
  'majority',
  'many',
  'media',
  'men',
  'people',
  'personnel',
  'police',
  'poor',
  'rich',
  'staff',
  'they',
  'we',
  'women',
  'you',
  'young',
  'youth',
]);
const IMPERATIVE_VERBS = new Set(['tell', 'say', 'go']);
const CLAUSE_SUBJECTS = new Set(['he', 'she', 'it', 'i', 'we', 'they', 'you']);
// "the world have", "that already have", "this will have": the word after "the" is not the subject.
const NOT_A_SUBJECT = new Set([
  'all', 'already', 'also', 'always', 'both', 'can', 'could', 'may', 'might', 'must', 'never',
  'often', 'should', 'still', 'that', 'which', 'who', 'will', 'would',
]);
const PREPOSITIONS = new Set([
  'about', 'across', 'around', 'at', 'by', 'during', 'for', 'from', 'in', 'into', 'of', 'on',
  'over', 'through', 'to', 'with',
]);

const SUBJECT_PRONOUNS = Object.freeze(new Map([['him', 'He'], ['her', 'She'], ['them', 'They']]));

const OBJECT_PRONOUNS = new Set(['him', 'her', 'them', 'he', 'she', 'they', 'us', 'we', 'you']);

const WHOS_NON_NOUNS = new Set([
  'a', 'already', 'also', 'an', 'at', 'been', 'he', 'her', 'here', 'his', 'i', 'in', 'it', 'just',
  'my', 'new', 'next', 'not', 'on', 'our', 'out', 'ready', 'really', 'she', 'still', 'that', 'the',
  'their', 'there', 'they', 'this', 'to', 'up', 'we', 'what', 'you', 'your',
]);

const PERFECT_AUXILIARIES = new Set(['have', 'has', 'had', "haven't", "hasn't", "hadn't"]);

const INDEFINITE_PLURAL_VERBS = Object.freeze(
  new Map([
    ['have', 'has'],
    ['are', 'is'],
    ['were', 'was'],
    ['do', 'does'],
    ["don't", "doesn't"],
  ]),
);

// Words after which a base verb is correct: questions, infinitives, causatives, subjunctives.
const BASE_VERB_CONTEXT = new Set([
  'can', 'could', 'did', 'do', 'does', 'had', 'has', 'have', 'help', 'helped', 'helps', 'if',
  'let', 'lets', 'made', 'make', 'makes', 'may', 'might', 'must', 'shall', 'should', 'that',
  'though', 'to', 'unless', 'will', 'wish', 'wished', 'would',
]);

const PAST_PARTICIPLE =
  /^\s+(?:been|done|seen|taken|gone|made|had|got|gotten|given|left|eaten|written|told|said|found|lost|forgotten|[\p{L}]+ed)\b/iu;

const THIRD_PERSON_VERBS = Object.freeze(
  new Map([
    ['agrees', 'agree'], ['barks', 'bark'], ['belongs', 'belong'], ['buys', 'buy'],
    ['comes', 'come'], ['contains', 'contain'], ['costs', 'cost'], ['cries', 'cry'],
    ['depends', 'depend'], ['does', 'do'], ['eats', 'eat'], ['enjoys', 'enjoy'],
    ['feels', 'feel'], ['finds', 'find'], ['gets', 'get'], ['gives', 'give'], ['goes', 'go'],
    ['has', 'have'], ['hates', 'hate'], ['helps', 'help'], ['includes', 'include'],
    ['keeps', 'keep'], ['knows', 'know'], ['leaves', 'leave'], ['likes', 'like'],
    ['lives', 'live'], ['looks', 'look'], ['loves', 'love'], ['makes', 'make'],
    ['needs', 'need'], ['pays', 'pay'], ['plays', 'play'], ['prefers', 'prefer'],
    ['reads', 'read'], ['requires', 'require'], ['runs', 'run'], ['says', 'say'],
    ['seems', 'seem'], ['sees', 'see'], ['sends', 'send'], ['shows', 'show'], ['sings', 'sing'],
    ['sits', 'sit'], ['sleeps', 'sleep'], ['stands', 'stand'], ['starts', 'start'],
    ['stays', 'stay'], ['takes', 'take'], ['talks', 'talk'], ['tells', 'tell'],
    ['thinks', 'think'], ['tries', 'try'], ['uses', 'use'], ['walks', 'walk'],
    ['wants', 'want'], ['works', 'work'], ['writes', 'write'],
  ]),
);

const SINGULAR_S_NOUNS = new Set([
  'alias', 'atlas', 'bias', 'canvas', 'chaos', 'christmas', 'gas', 'kudos', 'lens', 'means',
  'news', 'series', 'species', 'texas', 'yes',
]);

const COUNT_NOUNS = new Set([
  'calls', 'cars', 'cases', 'children', 'customers', 'days', 'emails', 'employees', 'errors',
  'files', 'friends', 'hours', 'issues', 'items', 'jobs', 'meetings', 'members', 'minutes',
  'mistakes', 'options', 'people', 'points', 'problems', 'questions', 'steps', 'students',
  'tasks', 'things', 'users', 'words',
]);

const FORWARD_TO_GERUNDS = Object.freeze(
  new Map([
    ['catch', 'catching'], ['chat', 'chatting'], ['discuss', 'discussing'], ['get', 'getting'],
    ['hear', 'hearing'], ['join', 'joining'], ['learn', 'learning'], ['meet', 'meeting'],
    ['read', 'reading'], ['receive', 'receiving'], ['see', 'seeing'], ['speak', 'speaking'],
    ['start', 'starting'], ['talk', 'talking'], ['visit', 'visiting'],
  ]),
);

const AGREE_FORMS = Object.freeze(new Map([['am', 'agree'], ['is', 'agrees'], ['are', 'agree']]));

const QUESTION_WORDS = new Set(['how', 'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why']);

const QUESTION_AUXILIARIES = new Set([
  'am', 'are', "aren't", 'can', "can't", 'could', "couldn't", 'did', "didn't", 'do', 'does',
  "doesn't", "don't", 'had', 'has', 'have', 'is', "isn't", 'should', "shouldn't", 'was',
  "wasn't", 'were', "weren't", 'will', "won't", 'would', "wouldn't",
]);

const QUESTION_SUBJECTS = new Set([
  'a', 'an', 'anybody', 'anyone', 'everybody', 'everyone', 'he', 'her', 'his', 'i', 'it', 'its',
  'my', 'our', 'people', 'she', 'somebody', 'someone', 'that', 'the', 'their', 'there', 'these',
  'they', 'this', 'those', 'we', 'you', 'your',
]);

function preserveCase(source: string, replacement: string): string {
  if (source === source.toLocaleUpperCase('en')) return replacement.toLocaleUpperCase('en');
  const first = source[0];
  if (first === undefined || first === first.toLocaleLowerCase('en')) return replacement;
  return `${replacement.slice(0, 1).toLocaleUpperCase('en')}${replacement.slice(1)}`;
}

function addIssue(
  issues: WritingIssue[],
  text: string,
  ruleId: string,
  start: number,
  end: number,
  message: string,
  replacements: readonly string[],
  category: IssueCategory = 'grammar',
): void {
  if (issues.some((issue) => issue.range.start === start && issue.range.end === end)) return;
  const contextStart = Math.max(0, start - 32);
  const contextEnd = Math.min(text.length, end + 32);
  const hash = issueHash(ruleId, text.slice(contextStart, contextEnd));
  issues.push(
    Object.freeze({
      id: `${hash}-${start}-${end}`,
      source: 'typecheck',
      ruleId,
      range: Object.freeze({ start, end }),
      category,
      message,
      replacements: Object.freeze([...replacements]),
      originalText: text.slice(start, end),
      confidence: 0.94,
      issueHash: hash,
    }),
  );
}

function verbRange(
  match: RegExpMatchArray,
  verb: string,
): Readonly<{ start: number; end: number }> {
  const matchStart = match.index ?? 0;
  const relativeStart = match[0].toLocaleLowerCase('en').lastIndexOf(
    verb.toLocaleLowerCase('en'),
  );
  const start = matchStart + relativeStart;
  return Object.freeze({ start, end: start + verb.length });
}

function sentenceContext(text: string, offset: number): string {
  if (offset <= 0) return '';
  const sentenceStart = Math.max(
    text.lastIndexOf('.', offset - 1),
    text.lastIndexOf('!', offset - 1),
    text.lastIndexOf('?', offset - 1),
  );
  return text.slice(sentenceStart + 1, offset);
}

function previousWord(text: string, offset: number): string | undefined {
  return text.slice(0, offset).match(/([\p{L}'’]+)\s*$/u)?.[1]?.toLocaleLowerCase('en').replace('’', "'");
}

// A question needs a question word, or an auxiliary followed by its subject ("Did you…").
function isQuestion(sentence: string): boolean {
  const words = sentence.trim().toLocaleLowerCase('en').replaceAll('’', "'").split(/\s+/u);
  const [first, second] = words;
  if (first === undefined) return false;
  if (QUESTION_WORDS.has(first)) return !(first === 'what' && (second === 'a' || second === 'an'));
  if (!QUESTION_AUXILIARIES.has(first) || second === undefined || !QUESTION_SUBJECTS.has(second)) {
    return false;
  }
  if (first === 'do' && (second === 'it' || second === 'this' || second === 'that')) return false;
  if ((first === 'have' || first === 'had') && (second === 'a' || second === 'an' || second === 'the')) {
    return false;
  }
  return true;
}

function isPastNarrative(context: string): boolean {
  return /\b(?:yesterday|ago|was|were|had|did|last\s+(?:night|week|month|year)|[\p{L}]+ed)\b/iu.test(
    context,
  );
}

export function lintSupplementalGrammar(
  text: string,
  hasPrefixCompletion: (token: string) => boolean = () => false,
  wordPairs: WordPairs = EMPTY_WORD_PAIRS,
): readonly WritingIssue[] {
  const issues: WritingIssue[] = [];

  for (const confused of findConfusedWords(text, wordPairs)) {
    addIssue(issues, text, 'ConfusedWord', confused.start, confused.end,
      `“${confused.original}” does not fit the words around it; did you mean “${confused.replacement}”?`,
      [confused.replacement]);
  }

  for (const match of text.matchAll(
    /\bme and ((?:(?:my|our|the|a|an)\s+)?[\p{L}]+)\b(?=\s+(?:am|is|are|was|were|has|have|do|does)\b)/giu,
  )) {
    const otherSubject = match[1];
    if (otherSubject === undefined || match.index === undefined) continue;
    if (OBJECT_PRONOUNS.has(otherSubject.toLocaleLowerCase('en'))) continue;
    addIssue(
      issues,
      text,
      'CompoundSubjectPronoun',
      match.index,
      match.index + match[0].length,
      'Use a subject pronoun in a compound subject.',
      [`${preserveCase(match[0], otherSubject)} and I`],
    );
  }

  for (const match of text.matchAll(
    /\b(a|an)\s+(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(second|minute|hour|day|week|month|year)\s+([\p{L}]+)/giu,
  )) {
    const quantity = match[2];
    const unit = match[3];
    if (quantity === undefined || unit === undefined || match.index === undefined) continue;
    const original = `${quantity} ${unit}`;
    const start = match.index + match[0].toLocaleLowerCase('en').indexOf(original.toLocaleLowerCase('en'));
    addIssue(issues, text, 'CompoundQuantityHyphen', start, start + original.length,
      'Hyphenate a quantity used as a modifier before a noun.', [`${quantity}-${unit}`], 'punctuation');
  }

  for (const match of text.matchAll(/(?<=\S) {2,}(?=\S)/gu)) {
    if (match.index === undefined) continue;
    addIssue(issues, text, 'MultipleSpaces', match.index, match.index + match[0].length,
      'Use a single space between words.', [' '], 'punctuation');
  }

  for (const match of text.matchAll(/,(?:\s*,)+/gu)) {
    if (match.index === undefined) continue;
    addIssue(issues, text, 'RepeatedComma', match.index, match.index + match[0].length,
      'Use a single comma here.', [','], 'punctuation');
  }

  for (const match of text.matchAll(/\b(dont|cant|wont|isnt|arent|wasnt|werent|doesnt|didnt)\b/giu)) {
    if (match.index === undefined) continue;
    const original = match[0];
    const replacement = original.replace(/nt$/iu, "n't");
    addIssue(issues, text, 'MissingApostrophe', match.index, match.index + original.length,
      'Use an apostrophe in this contraction.', [preserveCase(original, replacement)], 'punctuation');
  }

  // Only "however" at the start of a sentence; mid-sentence ("can therefore adapt") needs no comma, and
  // "Therefore people will…" without one is accepted by human editors.
  for (const match of text.matchAll(/(?<=^|[.!?;]\s+)however\s+(?=[\p{Ll}])/giu)) {
    if (match.index === undefined) continue;
    const original = match[0].trimEnd();
    addIssue(issues, text, 'IntroductoryComma', match.index, match.index + original.length,
      'Use a comma after this introductory transition.', [`${original},`], 'punctuation');
  }

  for (const match of text.matchAll(/\b(?:we|they|i|he|she|it)\s*,\s+(?:was|were|is|are|have|has|do|does)\b/giu)) {
    if (match.index === undefined) continue;
    const comma = match.index + match[0].indexOf(',');
    addIssue(issues, text, 'UnnecessarySubjectComma', comma, comma + 1,
      'Do not separate a subject from its verb with a comma.', [''], 'punctuation');
  }

  const trimmed = text.trimEnd();
  const wordCount = trimmed.match(/[\p{L}\d]+(?:['’][\p{L}]+)*/gu)?.length ?? 0;
  if (wordCount > 1 && !/[.!?…]$/u.test(trimmed) && /[\p{L}\d]$/u.test(trimmed)) {
    const end = trimmed.length;
    const start = Math.max(trimmed.lastIndexOf(' ') + 1, 0);
    const original = text.slice(start, end);
    if (!hasPrefixCompletion(original)) {
      const sentenceStart = Math.max(
        trimmed.lastIndexOf('.'), trimmed.lastIndexOf('!'), trimmed.lastIndexOf('?'),
      ) + 1;
      const mark = isQuestion(trimmed.slice(sentenceStart)) ? '?' : '.';
      addIssue(issues, text, 'SentenceEndingPunctuation', start, end,
        'End this sentence with punctuation.', [`${original}${mark}`], 'punctuation');
    }
  }

  // One side must be a personal pronoun: "concepts and ideas is" is a gerund-phrase subject, and "tired and
  // the night is" joins two clauses.
  for (const match of text.matchAll(
    /\b(?:(?:me|i|you|he|she|we|they)\s+and\s+(?:(?:my|our|the|a|an)\s+)?[\p{L}]+|[\p{L}]+\s+and\s+(?:me|i|you|he|she|we|they))\s+(was|is|has|does)\b/giu,
  )) {
    const verb = match[1];
    if (verb === undefined) continue;
    // "others and he has" starts a new clause: a subject pronoun right before the verb owns it.
    const beforeVerb = match[0].slice(0, -verb.length).trim().split(/\s+/u).at(-1)?.toLocaleLowerCase('en');
    if (beforeVerb !== undefined && CLAUSE_SUBJECTS.has(beforeVerb)) continue;
    const replacement = COMPOUND_SUBJECT_VERBS.get(verb.toLocaleLowerCase('en'));
    if (replacement === undefined) continue;
    const range = verbRange(match, verb);
    addIssue(
      issues,
      text,
      'CompoundSubjectAgreement',
      range.start,
      range.end,
      'Use a plural verb with a compound subject.',
      [preserveCase(verb, replacement)],
    );
  }

  for (const match of text.matchAll(
    /\b(?:we|they|you)\s+(was|is|has|does|doesn't|doesn’t)\b/giu,
  )) {
    const verb = match[1];
    if (verb === undefined) continue;
    const replacement = PLURAL_SUBJECT_VERBS.get(verb.toLocaleLowerCase('en'));
    if (replacement === undefined) continue;
    const range = verbRange(match, verb);
    addIssue(
      issues,
      text,
      'PluralSubjectAgreement',
      range.start,
      range.end,
      'Make the verb agree with its plural subject.',
      [preserveCase(verb, replacement)],
    );
  }

  for (const match of text.matchAll(
    /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[2-9]\d*)\s+(second|minute|hour|day|week|month|year)\b/giu,
  )) {
    const unit = match[1];
    if (unit === undefined) continue;
    // "a two week holiday" is a modifier; CompoundQuantityHyphen owns it.
    if (/(?:^|[^\p{L}])an?\s+$/iu.test(text.slice(Math.max(0, (match.index ?? 0) - 4), match.index))) continue;
    const range = verbRange(match, unit);
    addIssue(
      issues,
      text,
      'PluralQuantityUnit',
      range.start,
      range.end,
      'Use a plural unit after this quantity.',
      [preserveCase(unit, `${unit.toLocaleLowerCase('en')}s`)],
    );
  }

  for (const match of text.matchAll(
    /\b(?:someone|somebody|everyone|everybody|anyone|anybody|no one|nobody)\s+(tell|say|go|know|want|need)\b/giu,
  )) {
    const verb = match[1];
    if (verb === undefined) continue;
    const replacements = INDEFINITE_SUBJECT_VERBS.get(verb.toLocaleLowerCase('en'));
    if (replacements === undefined || match.index === undefined) continue;
    // "Does anyone know", "let everyone know", "Should anyone need": the base verb is right there.
    const before = previousWord(text, match.index);
    if (before !== undefined && BASE_VERB_CONTEXT.has(before)) continue;
    const range = verbRange(match, verb);
    const context = sentenceContext(text, match.index ?? 0);
    // At a sentence start "Somebody tell him!" can be a command; "Everyone know" cannot.
    if (context.trim().length === 0 && IMPERATIVE_VERBS.has(verb.toLocaleLowerCase('en'))) continue;
    const ordered = isPastNarrative(sentenceContext(text, range.start))
      ? [replacements[1], replacements[0]]
      : replacements;
    addIssue(
      issues,
      text,
      'IndefiniteSubjectAgreement',
      range.start,
      range.end,
      'Make the verb agree with its singular subject and the surrounding tense.',
      ordered,
    );
  }

  for (const match of text.matchAll(/\b(?:the|this|that)\s+([\p{L}]+)\s+(have)\b/giu)) {
    const noun = match[1];
    const verb = match[2];
    if (
      noun === undefined ||
      verb === undefined ||
      noun.toLocaleLowerCase('en').endsWith('s') ||
      NON_SINGULAR_NOUNS.has(noun.toLocaleLowerCase('en')) ||
      NOT_A_SUBJECT.has(noun.toLocaleLowerCase('en'))
    ) {
      continue;
    }
    // "companies around the world have": the noun is inside a phrase that describes the real subject.
    const before = previousWord(text, match.index ?? 0);
    if (before !== undefined && PREPOSITIONS.has(before)) continue;
    const range = verbRange(match, verb);
    const followingText = text.slice(range.end);
    const pastPerfect = /^\s+already\s+[\p{L}]+(?:ed|en)\b[^.!?]*\bbefore\b/iu.test(
      followingText,
    );
    addIssue(
      issues,
      text,
      pastPerfect ? 'PastPerfectBefore' : 'SingularSubjectHave',
      range.start,
      range.end,
      pastPerfect
        ? 'Use the past perfect for an action completed before another past action.'
        : 'Make the verb agree with its singular subject.',
      pastPerfect ? ['had', 'has'] : ['has'],
    );
  }

  for (const match of text.matchAll(
    /(?<=^|[.!?]\s+)me and ((?:(?:my|our|the|a|an)\s+)?[\p{L}]+)(?=\s+(?:went|came|saw|got|had|did|made|took|left|ran|said|told|found|ate|[\p{L}]+ed)\b)/giu,
  )) {
    const otherSubject = match[1];
    if (otherSubject === undefined || match.index === undefined) continue;
    if (OBJECT_PRONOUNS.has(otherSubject.toLocaleLowerCase('en'))) continue;
    addIssue(issues, text, 'CompoundSubjectPronoun', match.index, match.index + match[0].length,
      'Use a subject pronoun in a compound subject.', [`${preserveCase(match[0], otherSubject)} and I`]);
  }

  for (const match of text.matchAll(
    /(?<=^|[.!?]\s+)(?:me and (him|her|them)|(him|her|them) and (?:me|i))\b(?=\s+[\p{L}])/giu,
  )) {
    const subject = SUBJECT_PRONOUNS.get((match[1] ?? match[2] ?? '').toLocaleLowerCase('en'));
    if (subject === undefined || match.index === undefined) continue;
    addIssue(issues, text, 'CompoundSubjectPronoun', match.index, match.index + match[0].length,
      'Use subject pronouns in a compound subject.', [`${subject} and I`]);
  }

  for (const match of text.matchAll(/\b(who['’]s)\s+([\p{L}]+)\s+(?:is|are|was|were)\b/giu)) {
    const whos = match[1];
    const word = match[2]?.toLocaleLowerCase('en');
    if (whos === undefined || word === undefined || match.index === undefined) continue;
    if (WHOS_NON_NOUNS.has(word) || /(?:ing|ed|ly)$/u.test(word)) continue;
    addIssue(issues, text, 'WhoseOwnership', match.index, match.index + whos.length,
      'Use “whose” to ask who something belongs to.', [preserveCase(whos, 'whose')]);
  }

  for (const match of text.matchAll(/\b(?:i|we|they|you|he|she)\s+(seen)\b/giu)) {
    const verb = match[1];
    if (verb === undefined || match.index === undefined) continue;
    const before = previousWord(text, match.index);
    if (before !== undefined && PERFECT_AUXILIARIES.has(before)) continue;
    const range = verbRange(match, verb);
    addIssue(issues, text, 'PastTenseSeen', range.start, range.end,
      'Use “saw”, or add “have” before “seen”.', [preserveCase(verb, 'saw')]);
  }

  for (const match of text.matchAll(
    /\b(?:someone|somebody|everyone|everybody|anyone|anybody|no one|nobody)\s+(have|are|were|do|don't|don’t)\b/giu,
  )) {
    const verb = match[1];
    if (verb === undefined || match.index === undefined) continue;
    const normalizedVerb = verb.toLocaleLowerCase('en').replace('’', "'");
    const replacement = INDEFINITE_PLURAL_VERBS.get(normalizedVerb);
    if (replacement === undefined) continue;
    const before = previousWord(text, match.index);
    if (before !== undefined && BASE_VERB_CONTEXT.has(before)) continue;
    const range = verbRange(match, verb);
    const opensSentence = sentenceContext(text, match.index).trim().length === 0;
    // "Everyone have a seat." and "Everybody do your best." can be commands.
    if (opensSentence && (normalizedVerb === 'do' || normalizedVerb === "don't")) continue;
    if (opensSentence && normalizedVerb === 'have' && !PAST_PARTICIPLE.test(text.slice(range.end))) continue;
    addIssue(issues, text, 'IndefiniteSubjectAgreement', range.start, range.end,
      'Make the verb agree with its singular subject.', [preserveCase(verb, replacement)]);
  }

  for (const match of text.matchAll(
    /\b(?:the|these|those|my|our|your|their|his|her|many|several|both|all|some)\s+([\p{L}]+s)\s+([\p{L}]+)\b/giu,
  )) {
    const noun = match[1]?.toLocaleLowerCase('en');
    const verb = match[2];
    if (noun === undefined || verb === undefined) continue;
    if (/(?:ss|us|is|ics)$/u.test(noun) || SINGULAR_S_NOUNS.has(noun)) continue;
    const replacement = THIRD_PERSON_VERBS.get(verb.toLocaleLowerCase('en'));
    if (replacement === undefined) continue;
    const range = verbRange(match, verb);
    addIssue(issues, text, 'PluralNounAgreement', range.start, range.end,
      'Use the plural verb form with a plural subject.', [preserveCase(verb, replacement)]);
  }

  for (const match of text.matchAll(/\b(less)\s+([\p{L}]+)\b/giu)) {
    const less = match[1];
    const noun = match[2]?.toLocaleLowerCase('en');
    if (less === undefined || noun === undefined || match.index === undefined) continue;
    if (!COUNT_NOUNS.has(noun)) continue;
    addIssue(issues, text, 'FewerWithCountNouns', match.index, match.index + less.length,
      'Use “fewer” with things you can count.', [preserveCase(less, 'fewer')]);
  }

  for (const match of text.matchAll(/\b(?:look|looks|looking|looked)\s+forward\s+to\s+([\p{L}]+)\b/giu)) {
    const verb = match[1];
    if (verb === undefined) continue;
    const gerund = FORWARD_TO_GERUNDS.get(verb.toLocaleLowerCase('en'));
    if (gerund === undefined) continue;
    const range = verbRange(match, verb);
    addIssue(issues, text, 'LookForwardToGerund', range.start, range.end,
      'Use the -ing form after “look forward to”.', [preserveCase(verb, gerund)]);
  }

  for (const match of text.matchAll(/\b(am|is|are)\s+agree\b/giu)) {
    const auxiliary = match[1];
    if (auxiliary === undefined || match.index === undefined) continue;
    const replacement = AGREE_FORMS.get(auxiliary.toLocaleLowerCase('en'));
    if (replacement === undefined) continue;
    addIssue(issues, text, 'AgreeIsAVerb', match.index, match.index + match[0].length,
      '“Agree” is a verb, so it does not need “am”, “is”, or “are”.', [preserveCase(match[0], replacement)]);
  }

  for (const match of text.matchAll(/\byour welcome\b(?=\s*(?:[.!,]|$))/giu)) {
    if (match.index === undefined) continue;
    addIssue(issues, text, 'YoureWelcome', match.index, match.index + match[0].length,
      'Use “you’re” (you are) here.', [preserveCase(match[0], "you're welcome")]);
  }

  for (const match of text.matchAll(
    /(?<=^|[.!?]\s+|\b(?:and|but|because|so)\s+)there(?=\s+(?:going|coming|leaving|trying|working|playing|waiting|looking|doing)\b(?!\s+to\s+be\b))/giu,
  )) {
    if (match.index === undefined) continue;
    addIssue(issues, text, 'TheyreForThere', match.index, match.index + match[0].length,
      'Use “they’re” (they are) here.', [preserveCase(match[0], "they're")]);
  }

  for (const match of text.matchAll(
    /\b(?:go|goes|going|went|gone|been|get|got|over|out|in|to|stay|live|lives|lived|sit|stand)\s+(their)\b(?=\s*(?:[.!?,;]|$))/giu,
  )) {
    const their = match[1];
    if (their === undefined) continue;
    const range = verbRange(match, their);
    addIssue(issues, text, 'ThereForPlace', range.start, range.end,
      'Use “there” for a place.', [preserveCase(their, 'there')]);
  }

  for (const match of text.matchAll(
    /\b(?:to|will|would|could|might|may|can|can't|cannot|don't|didn't|not|never)\s+(loose)\s+(?=(?:weight|track|money|time|interest|control|sleep|hope|focus|count|my|your|his|her|our|their|the|it|this|that)\b)/giu,
  )) {
    const loose = match[1];
    if (loose === undefined) continue;
    const range = verbRange(match, loose);
    addIssue(issues, text, 'LoseNotLoose', range.start, range.end,
      'Use “lose” (to misplace or stop having).', [preserveCase(loose, 'lose')]);
  }

  return Object.freeze(issues);
}

export function supplementGrammarIssues(
  primaryIssues: readonly WritingIssue[],
  text: string,
  hasPrefixCompletion?: (token: string) => boolean,
  wordPairs?: WordPairs,
): readonly WritingIssue[] {
  const issues = [...primaryIssues];
  for (const issue of lintSupplementalGrammar(text, hasPrefixCompletion, wordPairs)) {
    const duplicate = issues.some(
      (candidate) =>
        candidate.category !== 'style' &&
        candidate.range.start === issue.range.start &&
        candidate.range.end === issue.range.end,
    );
    if (!duplicate) issues.push(issue);
  }
  return Object.freeze(
    issues.sort(
      (left, right) =>
        Number(left.category === 'style') - Number(right.category === 'style'),
    ),
  );
}
