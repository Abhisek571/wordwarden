use hashbrown::{HashMap, hash_map::Entry};

use crate::{CharString, DictWordMetadata};

use super::WordId;

/// The underlying data structure for the `MutableDictionary`.
///
/// Entries sit in one dense list, found through a small index from word ID to position. A hash table of
/// whole entries keeps up to half of its slots empty, and each slot is as large as an entry.
#[derive(Debug, Clone, Default)]
pub struct WordMap {
    entries: Vec<WordMapEntry>,
    index: HashMap<WordId, usize>,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub struct WordMapEntry {
    pub metadata: DictWordMetadata,
    pub canonical_spelling: CharString,
}

impl WordMap {
    /// Get an entry from the word map using raw chars.
    pub fn get_with_str(&self, string: &str) -> Option<&WordMapEntry> {
        let chars: CharString = string.chars().collect();
        let id = WordId::from_word_chars(chars);

        self.get(&id)
    }

    pub fn contains_str(&self, string: &str) -> bool {
        self.get_with_str(string).is_some()
    }

    pub fn contains_chars(&self, chars: impl AsRef<[char]>) -> bool {
        self.get_with_chars(chars).is_some()
    }

    pub fn contains(&self, id: &WordId) -> bool {
        self.get(id).is_some()
    }

    /// Get an entry from the word map using raw chars.
    pub fn get_with_chars(&self, chars: impl AsRef<[char]>) -> Option<&WordMapEntry> {
        let id = WordId::from_word_chars(chars);

        self.get(&id)
    }

    /// Get an entry from the word map using a word identifier.
    pub fn get(&self, id: &WordId) -> Option<&WordMapEntry> {
        self.index.get(id).map(|&position| &self.entries[position])
    }

    /// Borrow a word's metadata mutably
    pub fn get_metadata_mut_chars(
        &mut self,
        chars: impl AsRef<[char]>,
    ) -> Option<&mut DictWordMetadata> {
        let id = WordId::from_word_chars(chars);

        self.get_metadata_mut(&id)
    }

    /// Borrow a word's metadata mutably
    pub fn get_metadata_mut(&mut self, id: &WordId) -> Option<&mut DictWordMetadata> {
        let position = *self.index.get(id)?;
        Some(&mut self.entries[position].metadata)
    }

    pub fn insert(&mut self, entry: WordMapEntry) {
        let id = WordId::from_word_chars(&entry.canonical_spelling);

        match self.index.entry(id) {
            Entry::Occupied(found) => self.entries[*found.get()] = entry,
            Entry::Vacant(slot) => {
                slot.insert(self.entries.len());
                self.entries.push(entry);
            }
        }
    }

    /// Reserves capacity for at least `additional` more elements to be inserted
    /// in the `WordMap`. The collection may reserve more space to avoid
    /// frequent reallocations.
    pub fn reserve(&mut self, additional: usize) {
        self.entries.reserve(additional);
        self.index.reserve(additional);
    }

    /// Frees the room reserved for entries beyond the current ones.
    pub fn shrink_to_fit(&mut self) {
        self.entries.shrink_to_fit();
    }

    /// Iterate through the canonical spellings of the words in the map.
    pub fn iter(&self) -> impl Iterator<Item = &WordMapEntry> {
        self.entries.iter()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            entries: Vec::with_capacity(capacity),
            index: HashMap::with_capacity(capacity),
        }
    }
}

/// Two maps are equal when they hold the same entries, in any order.
impl PartialEq for WordMap {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len()
            && self
                .entries
                .iter()
                .all(|entry| other.get_with_chars(&entry.canonical_spelling) == Some(entry))
    }
}

impl Eq for WordMap {}

impl IntoIterator for WordMap {
    type Item = WordMapEntry;

    fn into_iter(self) -> Self::IntoIter {
        self.entries.into_iter()
    }

    type IntoIter = std::vec::IntoIter<WordMapEntry>;
}
