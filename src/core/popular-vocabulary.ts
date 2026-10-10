const vocabulary = [
  'Airbnb', 'Android', 'ChatGPT', 'Docker', 'GitHub', 'GitLab', 'GraphQL',
  'iOS', 'iPad', 'iPhone', 'Kubernetes', 'LinkedIn', 'macOS', 'MongoDB',
  'Netflix', 'OK', 'OpenAI', 'PostgreSQL', 'Shopify', 'SpaceX', 'Spotify',
  'TikTok', 'TypeScript', 'WhatsApp', 'YouTube',
] as const;

export const POPULAR_VOCABULARY: readonly string[] = Object.freeze([...vocabulary]);

export const popularVocabularyKeys: readonly string[] = Object.freeze(
  POPULAR_VOCABULARY.map((word) => word.toLocaleLowerCase('en')),
);

const popularVocabularyKeySet = new Set(popularVocabularyKeys);

// Words in capitals ("SDE", "FOMOD", "SDE's") are almost always acronyms or names.
const CAPITALS_WORD = /^\p{Lu}[\p{Lu}\d]+(?:['’]s)?$/u;

export function isCapitalsWord(word: string): boolean {
  return CAPITALS_WORD.test(word);
}

export function isPopularVocabularyWord(word: string): boolean {
  return popularVocabularyKeySet.has(word.toLocaleLowerCase('en'));
}

export function mergePopularVocabulary(personalWords: readonly string[]): readonly string[] {
  const canonicalByKey = new Map<string, string>();
  for (const word of POPULAR_VOCABULARY) canonicalByKey.set(word.toLocaleLowerCase('en'), word);
  for (const word of personalWords) {
    const key = word.toLocaleLowerCase('en');
    if (!canonicalByKey.has(key)) canonicalByKey.set(key, word);
  }
  return Object.freeze([...canonicalByKey.values()]);
}
