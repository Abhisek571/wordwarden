// Words the spelling card should not put in front of someone who did not type them. The ranker adds candidates from
// word frequency and sound, which reach far ("wp" → "wop", "pense" → "penis"); Harper offers far fewer.

/** Slurs: never offered as a correction. */
export const SLURS: ReadonlySet<string> = new Set([
  'beaner', 'beaners', 'chink', 'chinks', 'coon', 'coons', 'dago', 'dagos', 'dyke', 'dykes', 'fag', 'faggot',
  'faggots', 'fags', 'gook', 'gooks', 'jap', 'japs', 'kike', 'kikes', 'nigga', 'niggas', 'nigger', 'niggers', 'paki',
  'pakis', 'raghead', 'ragheads', 'retard', 'retards', 'spic', 'spics', 'towelhead', 'towelheads', 'tranny',
  'trannies', 'wetback', 'wetbacks', 'wop', 'wops',
]);

/**
 * Sexual and violent words: offered only for a typo one edit away from them (`peniss`), never as a far guess
 * (`pense` → `penis`, `semana` → `semen`). Ordinary swearing is left alone: `fkn` and `fuckn` are meant.
 */
export const VULGAR_WORDS: ReadonlySet<string> = new Set([
  'anal', 'anus', 'boob', 'boobs', 'booby', 'cock', 'cum', 'cunt', 'dick', 'dildo', 'horny', 'orgasm', 'penis', 'pimp',
  'porn', 'pussy', 'rape', 'raped', 'rapist', 'scrotum', 'semen', 'slut', 'tit', 'tits', 'twat', 'vagina', 'whore',
]);
