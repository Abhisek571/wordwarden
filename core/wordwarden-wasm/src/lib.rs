//! The WebAssembly interface of Wordwarden core: a [`Checker`] that checks plain text and returns what it finds
//! as plain JavaScript objects.

use std::sync::Arc;

use serde::Serialize;
use wasm_bindgen::prelude::*;
use wordwarden_core::linting::{LintGroup, Suggestion};
use wordwarden_core::parsers::PlainEnglish;
use wordwarden_core::spell::{Dictionary, FstDictionary, MergedDictionary, MutableDictionary};
use wordwarden_core::{CharString, DialectFlags, DictWordMetadata, Document, Lrc};

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// An English dialect.
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum Dialect {
    American,
    British,
    Australian,
    Canadian,
    Indian,
}

impl From<Dialect> for wordwarden_core::Dialect {
    fn from(dialect: Dialect) -> Self {
        match dialect {
            Dialect::American => wordwarden_core::Dialect::American,
            Dialect::British => wordwarden_core::Dialect::British,
            Dialect::Australian => wordwarden_core::Dialect::Australian,
            Dialect::Canadian => wordwarden_core::Dialect::Canadian,
            Dialect::Indian => wordwarden_core::Dialect::Indian,
        }
    }
}

/// One finding. `start` and `end` count UTF-16 code units, as JavaScript strings do.
#[derive(Serialize)]
struct Finding {
    rule: String,
    start: usize,
    end: usize,
    kind: String,
    message: String,
    suggestions: Vec<String>,
}

#[wasm_bindgen]
pub struct Checker {
    lint_group: LintGroup,
    /// The words added with [`Checker::add_words`].
    user_dictionary: MutableDictionary,
    /// The built-in dictionary and [`Self::user_dictionary`].
    dictionary: Arc<MergedDictionary>,
    dialect: Dialect,
}

#[wasm_bindgen]
impl Checker {
    /// Builds the dictionary and the rules, the slowest step of starting up.
    #[wasm_bindgen(constructor)]
    pub fn new(dialect: Dialect) -> Checker {
        let user_dictionary = MutableDictionary::new();
        let dictionary = merged_dictionary(&user_dictionary);
        let lint_group = LintGroup::new_curated_empty_config(dictionary.clone(), dialect.into());
        Checker {
            lint_group,
            user_dictionary,
            dictionary,
            dialect,
        }
    }

    /// Adds words to the dictionary, as words of this checker's dialect.
    pub fn add_words(&mut self, words: Vec<String>) {
        let count = self.user_dictionary.word_count();
        self.user_dictionary.extend_words(words.iter().map(|word| {
            (
                word.chars().collect::<CharString>(),
                DictWordMetadata {
                    dialects: DialectFlags::from_dialect(self.dialect.into()),
                    ..Default::default()
                },
            )
        }));
        // The rules are built over the dictionary, so they are rebuilt only when a word is new.
        if self.user_dictionary.word_count() > count {
            let config = self.lint_group.config.clone();
            self.dictionary = merged_dictionary(&self.user_dictionary);
            self.lint_group =
                LintGroup::new_curated_empty_config(self.dictionary.clone(), self.dialect.into());
            self.lint_group.config.merge_from(config);
        }
    }

    /// Replaces the rule settings with an object such as `{ OxfordComma: false }`. Rules it does not name keep
    /// their built-in setting.
    pub fn set_rules(&mut self, rules: JsValue) -> Result<(), String> {
        self.lint_group.config =
            serde_wasm_bindgen::from_value(rules).map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Checks plain text. The findings are ordered by rule name, then as the rule found them.
    pub fn check(&mut self, text: String) -> Result<JsValue, JsValue> {
        let source: Lrc<[char]> = text.chars().collect();
        let document = Document::new_from_chars(source.clone(), &PlainEnglish, &self.dictionary);

        let config = self.lint_group.config.clone();
        self.lint_group.config.fill_with_curated();
        let lints = self.lint_group.organized_lints(&document);
        self.lint_group.config = config;

        let findings: Vec<Finding> = lints
            .into_iter()
            .flat_map(|(rule, lints)| {
                let source = &source;
                lints.into_iter().map(move |lint| Finding {
                    rule: rule.clone(),
                    start: js_index(lint.span.start, source),
                    end: js_index(lint.span.end, source),
                    kind: lint.lint_kind.to_string_key(),
                    message: lint.message,
                    suggestions: lint
                        .suggestions
                        .iter()
                        .map(|suggestion| replacement_text(suggestion, &source[lint.span.start..lint.span.end]))
                        .collect(),
                })
            })
            .collect();
        Ok(serde_wasm_bindgen::to_value(&findings)?)
    }
}

/// The built-in dictionary with the user's words.
fn merged_dictionary(user_dictionary: &MutableDictionary) -> Arc<MergedDictionary> {
    let mut dictionary = MergedDictionary::new();
    dictionary.add_dictionary(FstDictionary::curated());
    dictionary.add_dictionary(Arc::new(user_dictionary.clone()));
    Arc::new(dictionary)
}

/// The text that replaces the finding's span: empty for a removal, and the span followed by the inserted text for an
/// insertion, so every suggestion can be applied the same way.
fn replacement_text(suggestion: &Suggestion, span_text: &[char]) -> String {
    match suggestion {
        Suggestion::Remove => String::new(),
        Suggestion::ReplaceWith(chars) => chars.iter().collect(),
        Suggestion::InsertAfter(chars) => span_text.iter().chain(chars).collect(),
    }
}

/// The position of the character at `char_index` in UTF-16 code units.
fn js_index(char_index: usize, source: &[char]) -> usize {
    source.iter().take(char_index).map(|c| c.len_utf16()).sum()
}
