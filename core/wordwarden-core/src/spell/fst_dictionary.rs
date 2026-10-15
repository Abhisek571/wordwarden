use std::{
    borrow::Cow,
    cell::RefCell,
    sync::{Arc, LazyLock},
};

use fst::{IntoStreamer, Map as FstMap, Streamer, map::StreamWithState};
use hashbrown::HashMap;
use levenshtein_automata::{DFA, LevenshteinAutomatonBuilder};

use super::{Dictionary, FuzzyMatchResult, MutableDictionary, WordId};
use crate::{CharString, CharStringExt, DictWordMetadata};

/// An immutable dictionary allowing for very fast spellchecking.
///
/// For dictionaries with changing contents, such as user and file dictionaries, prefer
/// [`MutableDictionary`].
pub struct FstDictionary {
    /// Underlying [`super::MutableDictionary`] used for everything except fuzzy finding
    mutable_dict: Arc<MutableDictionary>,
    /// Used for fuzzy-finding the WordId of words or metadata
    word_map: FstMap<Vec<u8>>,
}

const EXPECTED_DISTANCE: u8 = 3;
const TRANSPOSITION_COST_ONE: bool = true;

static DICT: LazyLock<Arc<FstDictionary>> =
    // Built from its own copy, so the cached `MutableDictionary::curated()` is not kept alive beside it.
    LazyLock::new(|| Arc::new(super::mutable_dictionary::uncached_curated().into()));

thread_local! {
    // Builders are computationally expensive and do not depend on the word, so we store a
    // collection of builders and the associated edit distance here.
    // Currently, the edit distance we use is three, but a value that does not exist in this
    // collection will create a new builder of that distance and push it to the collection.
    static AUTOMATON_BUILDERS: RefCell<Vec<(u8, LevenshteinAutomatonBuilder)>> = RefCell::new(vec![(
        EXPECTED_DISTANCE,
        LevenshteinAutomatonBuilder::new(EXPECTED_DISTANCE, TRANSPOSITION_COST_ONE),
    )]);
}

impl PartialEq for FstDictionary {
    fn eq(&self, other: &Self) -> bool {
        self.mutable_dict == other.mutable_dict
    }
}

impl FstDictionary {
    /// Create a dictionary from the curated dictionary included
    /// in the Harper binary.
    pub fn curated() -> Arc<Self> {
        (*DICT).clone()
    }

    /// Construct a new [`FstDictionary`] using a wordlist as a source.
    /// This can be expensive, so only use this if fast fuzzy searches are worth it.
    pub fn new(mut words: Vec<(CharString, DictWordMetadata)>) -> Self {
        words.sort_unstable_by(|(a, _), (b, _)| a.cmp(b));
        words.dedup_by(|(a, _), (b, _)| a == b);

        let mut builder = fst::MapBuilder::memory();
        for (word_chars, _) in words.iter() {
            let word = word_chars.iter().collect::<String>();
            builder
                .insert(word, WordId::from_word_chars(word_chars).into())
                .expect("Insertion not in lexicographical order!");
        }

        let mut mutable_dict = MutableDictionary::new();
        mutable_dict.extend_words(words.iter().cloned());

        let fst_bytes = builder.into_inner().unwrap();
        let word_map = FstMap::new(fst_bytes).expect("Unable to build FST map.");

        FstDictionary {
            mutable_dict: Arc::new(mutable_dict),
            word_map,
        }
    }

    /// Build the fast-lookup map over a finished dictionary and keep that dictionary, rather than a copy
    /// of it as [`Self::new`] does, which briefly needs memory for both.
    pub(crate) fn from_mutable(mutable_dict: MutableDictionary) -> Self {
        let fst_bytes = {
            // Code point order is the byte order of the UTF-8 the map stores.
            let mut words: Vec<&[char]> = mutable_dict.words_iter().collect();
            words.sort_unstable();
            words.dedup();

            let mut builder = fst::MapBuilder::memory();
            let mut word = String::new();
            for word_chars in words {
                word.clear();
                word.extend(word_chars);
                builder
                    .insert(&word, WordId::from_word_chars(word_chars).into())
                    .expect("Insertion not in lexicographical order!");
            }
            builder.into_inner().unwrap()
        };
        let word_map = FstMap::new(fst_bytes).expect("Unable to build FST map.");

        FstDictionary {
            mutable_dict: Arc::new(mutable_dict),
            word_map,
        }
    }
}

/// Above this many edits the dictionary is scanned instead: the automaton for four edits takes about a second and
/// 64 MB to build, which stay allocated, and the spell checker only searches that far for words with no match
/// within three.
const MAX_AUTOMATON_DISTANCE: u8 = 3;

/// The edit distance the automata compute, where swapping two neighbouring letters is one edit (optimal string
/// alignment), or `None` when it is more than `max`. `rows` is scratch space.
fn osa_distance_within(
    source: &[char],
    target: &[char],
    max: usize,
    rows: &mut [Vec<usize>; 3],
) -> Option<usize> {
    if source.len().abs_diff(target.len()) > max {
        return None;
    }
    let width = target.len() + 1;
    let [before_previous, previous, current] = rows;
    before_previous.clear();
    before_previous.resize(width, 0);
    previous.clear();
    previous.extend(0..width);
    current.clear();
    current.resize(width, 0);
    for i in 1..=source.len() {
        current[0] = i;
        let mut row_min = i;
        for j in 1..width {
            let cost = usize::from(source[i - 1] != target[j - 1]);
            let mut distance = (previous[j] + 1)
                .min(current[j - 1] + 1)
                .min(previous[j - 1] + cost);
            if i > 1 && j > 1 && source[i - 1] == target[j - 2] && source[i - 2] == target[j - 1] {
                distance = distance.min(before_previous[j - 2] + 1);
            }
            current[j] = distance;
            row_min = row_min.min(distance);
        }
        // Each row's smallest distance is at least the one before, so this word cannot come back within `max`.
        if row_min > max {
            return None;
        }
        std::mem::swap(before_previous, previous);
        std::mem::swap(previous, current);
    }
    let distance = previous[width - 1];
    (distance <= max).then_some(distance)
}

/// The positions of each character of a pattern of up to 64 characters, as bits.
struct PatternMasks {
    ascii: [u64; 128],
    other: Vec<(char, u64)>,
}

impl PatternMasks {
    fn new(pattern: &[char]) -> Self {
        let mut masks = Self {
            ascii: [0; 128],
            other: Vec::new(),
        };
        for (i, &c) in pattern.iter().enumerate() {
            let bit = 1u64 << i;
            if c.is_ascii() {
                masks.ascii[c as usize] |= bit;
            } else if let Some((_, mask)) = masks.other.iter_mut().find(|(other, _)| *other == c) {
                *mask |= bit;
            } else {
                masks.other.push((c, bit));
            }
        }
        masks
    }

    fn get(&self, c: char) -> u64 {
        if c.is_ascii() {
            self.ascii[c as usize]
        } else {
            self.other
                .iter()
                .find(|(other, _)| *other == c)
                .map_or(0, |(_, mask)| *mask)
        }
    }
}

/// [`osa_distance_within`] for a pattern of 1 to 64 characters, computed one machine word at a time over `target`
/// (the bit-vector form of the same recurrence, from Hyyrö's 2003 paper). It gives the same results.
fn osa_distance_bits(
    pattern_len: usize,
    masks: &PatternMasks,
    target: &[char],
    max: usize,
) -> Option<usize> {
    let last = 1u64 << (pattern_len - 1);
    let (mut vp, mut vn, mut d0) = (u64::MAX, 0u64, 0u64);
    let mut previous_mask = 0u64;
    let mut distance = pattern_len;
    for (j, &c) in target.iter().enumerate() {
        let mask = masks.get(c);
        let transposition = ((!d0 & mask) << 1) & previous_mask;
        d0 = ((((mask & vp).wrapping_add(vp)) ^ vp) | mask | vn) | transposition;
        let hp = vn | !(d0 | vp);
        let hn = d0 & vp;
        if hp & last != 0 {
            distance += 1;
        }
        if hn & last != 0 {
            distance -= 1;
        }
        let x = (hp << 1) | 1;
        vp = (hn << 1) | !(d0 | x);
        vn = x & d0;
        previous_mask = mask;
        // One more character can lower the distance by at most one.
        if distance > max + (target.len() - j - 1) {
            return None;
        }
    }
    (distance <= max).then_some(distance)
}

/// A word to compare with dictionary words, with its bit masks when it is short enough for [`osa_distance_bits`].
struct Query<'a> {
    chars: &'a [char],
    masks: Option<PatternMasks>,
}

impl<'a> Query<'a> {
    fn new(chars: &'a [char]) -> Self {
        let masks = (1..=64)
            .contains(&chars.len())
            .then(|| PatternMasks::new(chars));
        Self { chars, masks }
    }

    fn distance_within(
        &self,
        target: &[char],
        max: usize,
        rows: &mut [Vec<usize>; 3],
    ) -> Option<usize> {
        match &self.masks {
            Some(masks) if self.chars.len().abs_diff(target.len()) <= max => {
                osa_distance_bits(self.chars.len(), masks, target, max)
            }
            Some(_) => None,
            None => osa_distance_within(self.chars, target, max, rows),
        }
    }
}

/// Whether lowercasing leaves every character of the word as it is.
fn has_no_capitals(word: &[char]) -> bool {
    word.iter().all(|&c| {
        if c.is_ascii() {
            !c.is_ascii_uppercase()
        } else {
            c.to_lowercase().eq(std::iter::once(c))
        }
    })
}

impl FstDictionary {
    /// [`Dictionary::fuzzy_match`] by comparing the word with every word in the dictionary, with the same results
    /// as the automata.
    fn scan_fuzzy_match(
        &self,
        word: &[char],
        max_distance: u8,
        max_results: usize,
    ) -> Vec<FuzzyMatchResult<'_>> {
        let word = word.normalized();
        let word_string = word.to_string();
        let lower_string = word_string.to_lowercase();
        // Only compared with the lowercase form too when it differs, as the automata do.
        let lowercase: Option<Vec<char>> =
            (lower_string != word_string).then(|| lower_string.chars().collect());
        let max = usize::from(max_distance);
        let original = Query::new(&word);
        let lower = lowercase.as_deref().map(Query::new);
        // Lowercasing keeps the length of the word, and then a candidate with no capitals is no further from the
        // lowercase word than from the original, so only candidates with capitals need the original compared too.
        let lowercase_is_aligned = lower
            .as_ref()
            .is_some_and(|query| query.chars.len() == word.len());
        let mut rows = [Vec::new(), Vec::new(), Vec::new()];
        let mut found: Vec<(&[char], u8)> = Vec::new();
        for candidate in self.mutable_dict.words_iter() {
            let distance = if lowercase_is_aligned && has_no_capitals(candidate) {
                None
            } else {
                original.distance_within(candidate, max, &mut rows)
            };
            let lower_distance = lower
                .as_ref()
                .and_then(|query| query.distance_within(candidate, max, &mut rows));
            let best = match (distance, lower_distance) {
                (Some(a), Some(b)) => a.min(b),
                (Some(a), None) | (None, Some(a)) => a,
                (None, None) => continue,
            };
            // Ignore exact matches
            if best > 0 {
                found.push((candidate, best as u8));
            }
        }
        found.sort_unstable_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(b.0)));
        found.truncate(max_results);
        found
            .into_iter()
            .map(|(word, edit_distance)| FuzzyMatchResult {
                word,
                edit_distance,
                metadata: self.mutable_dict.get_word_metadata(word).unwrap(),
            })
            .collect()
    }

    /// [`Dictionary::fuzzy_match`] with Levenshtein automata over the FST.
    fn automaton_fuzzy_match(
        &self,
        word: &[char],
        max_distance: u8,
        max_results: usize,
    ) -> Vec<FuzzyMatchResult<'_>> {
        let misspelled_word_charslice = word.normalized();
        let misspelled_word_string = misspelled_word_charslice.to_string();
        let misspelled_lower = misspelled_word_string.to_lowercase();
        let is_already_lower = misspelled_lower == misspelled_word_string;

        // Actual FST search
        let dfa = build_dfa(max_distance, &misspelled_word_string);
        let mut word_ids_stream = self.word_map.search_with_state(&dfa).into_stream();
        let upper_dists = stream_distances_vec(&mut word_ids_stream, &dfa);

        // Merge the two results, keeping the smallest distance when both DFAs match.
        // The uppercase and lowercase searches can return different result counts, so
        // we can't simply zip the vectors without losing matches.
        let mut best_distances = HashMap::<u64, u8>::new();

        merge_best_distances(&mut best_distances, upper_dists);

        // Only build the lowercase DFA when the query is not already lowercase.
        if !is_already_lower {
            let dfa_lowercase = build_dfa(max_distance, &misspelled_lower);
            let mut word_ids_lowercase_stream = self
                .word_map
                .search_with_state(&dfa_lowercase)
                .into_stream();
            let lower_dists = stream_distances_vec(&mut word_ids_lowercase_stream, &dfa_lowercase);

            merge_best_distances(&mut best_distances, lower_dists);
        }

        let mut merged = Vec::with_capacity(best_distances.len());
        for (word_id, edit_distance) in best_distances {
            let word = self.mutable_dict.get_word_from_id(&word_id.into()).unwrap();
            let metadata = self.mutable_dict.get_word_metadata(word).unwrap();
            merged.push(FuzzyMatchResult {
                word,
                edit_distance,
                metadata,
            });
        }

        // Ignore exact matches
        merged.retain(|v| v.edit_distance > 0);
        merged.sort_unstable_by(|a, b| {
            a.edit_distance
                .cmp(&b.edit_distance)
                .then_with(|| a.word.cmp(b.word))
        });
        merged.truncate(max_results);

        merged
    }
}

fn build_dfa(max_distance: u8, query: &str) -> DFA {
    // Insert if it does not exist
    AUTOMATON_BUILDERS.with_borrow_mut(|v| {
        if !v.iter().any(|t| t.0 == max_distance) {
            v.push((
                max_distance,
                LevenshteinAutomatonBuilder::new(max_distance, TRANSPOSITION_COST_ONE),
            ));
        }
    });

    AUTOMATON_BUILDERS.with_borrow(|v| {
        v.iter()
            .find(|a| a.0 == max_distance)
            .unwrap()
            .1
            .build_dfa(query)
    })
}

/// Consumes a DFA stream and emits the WordID-edit distance pairs it produces.
fn stream_distances_vec(stream: &mut StreamWithState<&DFA>, dfa: &DFA) -> Vec<(u64, u8)> {
    let mut word_id_pairs = Vec::new();
    while let Some((_, v, s)) = stream.next() {
        word_id_pairs.push((v, dfa.distance(s).to_u8()));
    }

    word_id_pairs
}

/// Merges WordID-distance pairs, keeping the smallest distance for each word.
fn merge_best_distances(
    best_distances: &mut HashMap<u64, u8>,
    distances: impl IntoIterator<Item = (u64, u8)>,
) {
    for (word_id, dist) in distances {
        best_distances
            .entry(word_id)
            .and_modify(|existing| *existing = (*existing).min(dist))
            .or_insert(dist);
    }
}

impl Dictionary for FstDictionary {
    fn contains_word(&self, word: &[char]) -> bool {
        self.mutable_dict.contains_word(word)
    }

    fn contains_word_str(&self, word: &str) -> bool {
        self.mutable_dict.contains_word_str(word)
    }

    fn get_word_metadata(&self, word: &[char]) -> Option<Cow<'_, DictWordMetadata>> {
        self.mutable_dict.get_word_metadata(word)
    }

    fn get_word_metadata_str(&self, word: &str) -> Option<Cow<'_, DictWordMetadata>> {
        self.mutable_dict.get_word_metadata_str(word)
    }

    fn fuzzy_match(
        &'_ self,
        word: &[char],
        max_distance: u8,
        max_results: usize,
    ) -> Vec<FuzzyMatchResult<'_>> {
        if max_distance > MAX_AUTOMATON_DISTANCE {
            self.scan_fuzzy_match(word, max_distance, max_results)
        } else {
            self.automaton_fuzzy_match(word, max_distance, max_results)
        }
    }

    fn fuzzy_match_str(
        &'_ self,
        word: &str,
        max_distance: u8,
        max_results: usize,
    ) -> Vec<FuzzyMatchResult<'_>> {
        self.fuzzy_match(
            word.chars().collect::<Vec<_>>().as_slice(),
            max_distance,
            max_results,
        )
    }

    fn words_iter(&self) -> Box<dyn Iterator<Item = &'_ [char]> + Send + '_> {
        self.mutable_dict.words_iter()
    }

    fn word_count(&self) -> usize {
        self.mutable_dict.word_count()
    }

    fn contains_exact_word(&self, word: &[char]) -> bool {
        self.mutable_dict.contains_exact_word(word)
    }

    fn contains_exact_word_str(&self, word: &str) -> bool {
        self.mutable_dict.contains_exact_word_str(word)
    }

    fn get_correct_capitalization_of(&self, word: &[char]) -> Option<&'_ [char]> {
        self.mutable_dict.get_correct_capitalization_of(word)
    }

    fn get_word_from_id(&self, id: &WordId) -> Option<&[char]> {
        self.mutable_dict.get_word_from_id(id)
    }

    fn find_words_with_prefix(&self, prefix: &[char]) -> Vec<Cow<'_, [char]>> {
        self.mutable_dict.find_words_with_prefix(prefix)
    }

    fn find_words_with_common_prefix(&self, word: &[char]) -> Vec<Cow<'_, [char]>> {
        self.mutable_dict.find_words_with_common_prefix(word)
    }
}

#[cfg(test)]
mod tests {
    use itertools::Itertools;

    use crate::CharStringExt;
    use crate::DictWordMetadata;
    use crate::spell::{Dictionary, MutableDictionary, WordId};

    use super::{
        FstDictionary, PatternMasks, has_no_capitals, osa_distance_bits, osa_distance_within,
    };

    fn test_dictionaries(words: &[&str]) -> (MutableDictionary, FstDictionary) {
        let mut mutable = MutableDictionary::new();

        for word in words {
            mutable.append_word_str(word, DictWordMetadata::default());
        }

        let fst = FstDictionary::from(mutable.clone());

        (mutable, fst)
    }

    fn fuzzy_matches<D: Dictionary + ?Sized>(
        dict: &D,
        word: &str,
        max_distance: u8,
        max_results: usize,
    ) -> Vec<(String, u8)> {
        let mut matches = dict
            .fuzzy_match_str(word, max_distance, max_results)
            .into_iter()
            .map(|result| (result.word.iter().collect::<String>(), result.edit_distance))
            .collect_vec();

        matches.sort_unstable_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        matches
    }

    #[test]
    fn damerau_transposition_costs_one() {
        let lev_automata =
            levenshtein_automata::LevenshteinAutomatonBuilder::new(1, true).build_dfa("woof");
        assert_eq!(
            lev_automata.eval("wofo"),
            levenshtein_automata::Distance::Exact(1)
        );
    }

    #[test]
    fn damerau_transposition_costs_two() {
        let lev_automata =
            levenshtein_automata::LevenshteinAutomatonBuilder::new(1, false).build_dfa("woof");
        assert_eq!(
            lev_automata.eval("wofo"),
            levenshtein_automata::Distance::AtLeast(2)
        );
    }

    #[test]
    fn fst_map_contains_all_in_mutable_dict() {
        let dict = FstDictionary::curated();

        for word in dict.words_iter() {
            let misspelled_normalized = word.normalized();
            let misspelled_word = misspelled_normalized.to_string();
            let misspelled_lower = misspelled_normalized.to_lower().to_string();

            dbg!(&misspelled_lower);

            assert!(!misspelled_word.is_empty());
            assert!(dict.word_map.contains_key(misspelled_word));
        }
    }

    #[test]
    fn fst_contains_hello() {
        let dict = FstDictionary::curated();

        let word: Vec<_> = "hello".chars().collect();
        let misspelled_normalized = word.normalized();
        let misspelled_word = misspelled_normalized.to_string();
        let misspelled_lower = misspelled_normalized.to_lower().to_string();

        assert!(dict.contains_word(&misspelled_normalized));
        assert!(
            dict.word_map.contains_key(misspelled_lower)
                || dict.word_map.contains_key(misspelled_word)
        );
    }

    #[test]
    fn on_is_not_nominal() {
        let dict = FstDictionary::curated();

        assert!(!dict.get_word_metadata_str("on").unwrap().is_nominal());
    }

    #[test]
    fn dickens_is_not_a_swear_1656() {
        let dict = FstDictionary::curated();
        let metadata = dict.get_word_metadata_str("Dickens").unwrap();

        assert!(metadata.is_proper_noun());
        assert!(!metadata.is_swear());
        assert!(metadata.derived_from.is_none());
        assert!(dict.contains_exact_word_str("dickens"));
        assert!(dict.get_word_metadata_str("dick").unwrap().is_swear());
    }

    #[test]
    fn fuzzy_result_sorted_by_edit_distance() {
        let dict = FstDictionary::curated();

        let results = dict.fuzzy_match_str("hello", 3, 100);
        let is_sorted_by_dist = results
            .iter()
            .map(|fm| fm.edit_distance)
            .tuple_windows()
            .all(|(a, b)| a <= b);

        assert!(is_sorted_by_dist)
    }

    #[test]
    fn contractions_not_derived() {
        let dict = FstDictionary::curated();

        let contractions = ["there's", "we're", "here's"];

        for contraction in contractions {
            dbg!(contraction);
            assert!(
                dict.get_word_metadata_str(contraction)
                    .unwrap()
                    .derived_from
                    .is_none()
            )
        }
    }

    #[test]
    fn plural_llamas_derived_from_llama() {
        let dict = FstDictionary::curated();

        assert_eq!(
            dict.get_word_metadata_str("llamas")
                .unwrap()
                .derived_from
                .unwrap(),
            WordId::from_word_str("llama")
        )
    }

    #[test]
    fn plural_cats_derived_from_cat() {
        let dict = FstDictionary::curated();

        assert_eq!(
            dict.get_word_metadata_str("cats")
                .unwrap()
                .derived_from
                .unwrap(),
            WordId::from_word_str("cat")
        );
    }

    #[test]
    fn unhappy_derived_from_happy() {
        let dict = FstDictionary::curated();

        assert_eq!(
            dict.get_word_metadata_str("unhappy")
                .unwrap()
                .derived_from
                .unwrap(),
            WordId::from_word_str("happy")
        );
    }

    #[test]
    fn quickly_derived_from_quick() {
        let dict = FstDictionary::curated();

        assert_eq!(
            dict.get_word_metadata_str("quickly")
                .unwrap()
                .derived_from
                .unwrap(),
            WordId::from_word_str("quick")
        );
    }

    #[test]
    fn lowercase_fuzzy_match_matches_mutable_dictionary() {
        let (mutable, fst) =
            test_dictionaries(&["spelling", "spilling", "selling", "smelling", "shelling"]);

        let mutable_results = fuzzy_matches(&mutable, "speling", 3, 10);
        let fst_results = fuzzy_matches(&fst, "speling", 3, 10);

        assert_eq!(fst_results, mutable_results);
        assert_eq!(fst_results.first(), Some(&(String::from("spelling"), 1)));
    }

    #[test]
    fn capitalized_fuzzy_match_matches_mutable_dictionary() {
        let (mutable, fst) =
            test_dictionaries(&["spelling", "spilling", "selling", "smelling", "shelling"]);

        let mutable_results = fuzzy_matches(&mutable, "Speling", 3, 10);
        let fst_results = fuzzy_matches(&fst, "Speling", 3, 10);

        assert_eq!(fst_results, mutable_results);
        assert_eq!(fst_results.first(), Some(&(String::from("spelling"), 1)));
    }

    #[test]
    fn uppercase_fuzzy_match_matches_mutable_dictionary() {
        let (mutable, fst) =
            test_dictionaries(&["spelling", "spilling", "selling", "smelling", "shelling"]);

        let mutable_results = fuzzy_matches(&mutable, "SPELING", 3, 10);
        let fst_results = fuzzy_matches(&fst, "SPELING", 3, 10);

        assert_eq!(fst_results, mutable_results);
        assert_eq!(fst_results.first(), Some(&(String::from("spelling"), 1)));
    }

    #[test]
    fn query_casing_produces_the_same_fuzzy_matches() {
        let (_, fst) =
            test_dictionaries(&["spelling", "spilling", "selling", "smelling", "shelling"]);

        let lowercase = fuzzy_matches(&fst, "speling", 3, 10);
        let capitalized = fuzzy_matches(&fst, "Speling", 3, 10);
        let uppercase = fuzzy_matches(&fst, "SPELING", 3, 10);

        assert_eq!(lowercase, capitalized);
        assert_eq!(lowercase, uppercase);
    }

    #[test]
    fn scan_matches_automata() {
        let dict = FstDictionary::curated();
        let words = [
            "recieve",
            "acksecetable",
            "Amanversery",
            "enthewseasem",
            "daxck",
            "teh",
            "Wensday",
            "beatyfool",
            "xqzvb",
            "approximentally",
            "I'de",
            "dont",
            "THEIR",
            "gramer",
            "cemontry",
        ];
        for word in words {
            let chars: Vec<char> = word.chars().collect();
            for distance in 1..=4 {
                let automaton: Vec<_> = dict
                    .automaton_fuzzy_match(&chars, distance, 200)
                    .into_iter()
                    .map(|m| (m.word.to_vec(), m.edit_distance))
                    .collect();
                let scan: Vec<_> = dict
                    .scan_fuzzy_match(&chars, distance, 200)
                    .into_iter()
                    .map(|m| (m.word.to_vec(), m.edit_distance))
                    .collect();
                assert_eq!(automaton, scan, "{word} within {distance}");
            }
        }
    }

    fn next_random(seed: &mut u64, n: usize) -> usize {
        *seed ^= *seed << 13;
        *seed ^= *seed >> 7;
        *seed ^= *seed << 17;
        (*seed % n as u64) as usize
    }

    fn random_word(seed: &mut u64, alphabet: &[char]) -> Vec<char> {
        let len = next_random(seed, 71);
        let mut word = Vec::with_capacity(len);
        for _ in 0..len {
            word.push(alphabet[next_random(seed, alphabet.len())]);
        }
        word
    }

    /// One random edit: a substitution, an insertion, a deletion or a transposition.
    fn mutate(seed: &mut u64, word: &mut Vec<char>, alphabet: &[char]) {
        let position = next_random(seed, word.len() + 1);
        let letter = alphabet[next_random(seed, alphabet.len())];
        match next_random(seed, 4) {
            0 if position < word.len() => word[position] = letter,
            1 => word.insert(position, letter),
            2 if position < word.len() => {
                word.remove(position);
            }
            _ if position + 1 < word.len() => word.swap(position, position + 1),
            _ => {}
        }
    }

    #[test]
    fn bit_parallel_distance_matches_dynamic_programming() {
        // A small alphabet with capitals and an accented letter, and targets that are edited copies of the pattern,
        // so that small distances come up often.
        let alphabet: Vec<char> = "abcAé".chars().collect();
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut rows = [Vec::new(), Vec::new(), Vec::new()];
        for _ in 0..100_000 {
            let source = random_word(&mut seed, &alphabet);
            let mut target = source.clone();
            for _ in 0..next_random(&mut seed, 5) {
                mutate(&mut seed, &mut target, &alphabet);
            }
            if next_random(&mut seed, 5) == 0 {
                target = random_word(&mut seed, &alphabet);
            }
            let max = next_random(&mut seed, 6);
            if !(1..=64).contains(&source.len()) {
                continue;
            }
            let masks = PatternMasks::new(&source);
            let bits = osa_distance_bits(source.len(), &masks, &target, max);
            let dp = osa_distance_within(&source, &target, max, &mut rows);
            assert_eq!(bits, dp, "{source:?} vs {target:?} within {max}");
        }
    }

    #[test]
    fn capitals_are_detected() {
        let chars = |word: &str| word.chars().collect::<Vec<char>>();
        assert!(has_no_capitals(&chars("wednesday")));
        assert!(has_no_capitals(&chars("élan")));
        assert!(has_no_capitals(&chars("can't")));
        assert!(!has_no_capitals(&chars("Wensday")));
        assert!(!has_no_capitals(&chars("ÉLAN")));
    }
}
