use crate::{
    TokenKind,
    linting::{Suggestion, SuggestionCollectionExt},
};

/// Gets synonyms for a provided word. Wordwarden core has no thesaurus, so this is always [`None`].
pub fn get_synonyms(_word: &str) -> Option<Vec<&str>> {
    None
}

/// Gets synonyms for a provided word, most relevant first. Wordwarden core has no thesaurus, so this is always
/// [`None`].
pub fn get_synonyms_sorted(_word: &str, _token: &TokenKind) -> Option<Vec<&'static str>> {
    None
}

/// Helper method to provide synonym replacement suggestions for the provided word.
///
/// Wordwarden core has no thesaurus, so this is always empty.
pub fn get_synonym_replacement_suggestions(
    word: &str,
    token: &TokenKind,
) -> impl Iterator<Item = Suggestion> {
    get_synonyms_sorted(word, token)
        .unwrap_or_default()
        .to_replace_suggestions(word.chars())
}
