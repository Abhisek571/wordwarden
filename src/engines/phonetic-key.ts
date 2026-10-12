// A compact sound key in the style of Metaphone: "fone", "phone" and "phoan" all become "FN", so a
// misspelling written by ear can be matched to the word it sounds like.

const VOWELS = 'aeiou';

function isVowel(letter: string | undefined): boolean {
  return letter !== undefined && VOWELS.includes(letter);
}

function isSoftening(letter: string | undefined): boolean {
  return letter === 'e' || letter === 'i' || letter === 'y';
}

export function phoneticKey(word: string): string {
  let letters = word.toLocaleLowerCase('en').replace(/[^a-z]/gu, '');
  // Silent first letters ("knife", "gnome", "pneumonia", "wrong"); a first "x" sounds like "s".
  if (/^(?:kn|gn|pn|ae|wr)/u.test(letters)) letters = letters.slice(1);
  else if (letters.startsWith('x')) letters = `s${letters.slice(1)}`;
  else if (letters.startsWith('wh')) letters = `w${letters.slice(2)}`;

  let key = '';
  for (let index = 0; index < letters.length; index += 1) {
    const letter = letters[index] ?? '';
    const previous = letters[index - 1];
    const next = letters[index + 1];
    const after = letters[index + 2];
    // Doubled letters sound once ("letter"), except "cc" ("accident" has a hard and a soft c).
    if (letter === previous && letter !== 'c') continue;
    switch (letter) {
      case 'a': case 'e': case 'i': case 'o': case 'u':
        // Vowels only count at the start: "about" and "abuot" both sound like "ABT".
        if (index === 0) key += 'A';
        break;
      case 'b':
        if (!(previous === 'm' && next === undefined)) key += 'B'; // "thumb"
        break;
      case 'c':
        if (next === 'i' && after === 'a') key += 'X'; // "social"
        else if (next === 'h') key += previous === 's' ? 'K' : 'X'; // "school", "chair"
        else if (isSoftening(next)) { if (previous !== 's') key += 'S'; } // "city"; "science" has one s sound
        else key += 'K';
        break;
      case 'd':
        key += next === 'g' && isSoftening(after) ? 'J' : 'T'; // "edge"
        break;
      case 'g':
        if (next === 'h') { if (index === 0 && isVowel(after)) key += 'K'; } // "ghost"; silent in "night", "high"
        else if (next === 'n' && (after === undefined || (after === 'e' && letters[index + 3] === 'd'))) break; // "sign", "signed"
        else if (isSoftening(next) && previous !== 'g') key += 'J'; // "giant"
        else key += 'K';
        break;
      case 'h':
        // Silent after a consonant that already took it ("chair", "ship", "phone", "this", "ghost") and
        // between a vowel and a consonant ("ahmed"); heard before a vowel ("hello", "ahead").
        if (previous === 'c' || previous === 's' || previous === 'p' || previous === 't' || previous === 'g') break;
        if (isVowel(previous) && !isVowel(next)) break;
        if (isVowel(next)) key += 'H';
        break;
      case 'k':
        if (previous !== 'c') key += 'K'; // "back"
        break;
      case 'p':
        key += next === 'h' ? 'F' : 'P'; // "phone"
        break;
      case 'q':
        key += 'K';
        break;
      case 's':
        if (next === 'h' || (next === 'i' && (after === 'o' || after === 'a'))) key += 'X'; // "ship", "vision"
        else key += 'S';
        break;
      case 't':
        if (next === 'i' && (after === 'o' || after === 'a')) key += 'X'; // "nation"
        else if (next === 'h') key += '0'; // "the"
        else if (!(next === 'c' && after === 'h')) key += 'T'; // "watch" has one ch sound
        break;
      case 'v':
        key += 'F';
        break;
      case 'w':
        if (isVowel(next)) key += 'W'; // "wet"; silent in "now"
        break;
      case 'x':
        key += 'KS';
        break;
      case 'y':
        if (isVowel(next)) key += 'Y'; // "yes"; silent in "day"
        break;
      case 'z':
        key += 'S';
        break;
      default:
        key += letter.toLocaleUpperCase('en'); // f, j, l, m, n, r
    }
  }
  return key;
}
