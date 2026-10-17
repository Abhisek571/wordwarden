use super::FirstWords;
use crate::{LSend, Token, patterns::Pattern};

/// An atomic step within a larger expression.
///
/// Its principle job is to identify (if any) the next position of the cursor.
/// When cursor is moved, all tokens between the current cursor and the target position will be
/// added to the match group.
pub trait Step: LSend {
    fn step(&self, tokens: &[Token], cursor: usize, source: &[char]) -> Option<isize>;

    /// See [`Expr::first_words`](super::Expr::first_words).
    fn first_words(&self) -> Option<FirstWords> {
        None
    }
}

impl<P> Step for P
where
    P: Pattern,
{
    fn step(&self, tokens: &[Token], cursor: usize, source: &[char]) -> Option<isize> {
        // A step can run at the end of the text, where no tokens are left.
        self.matches(tokens.get(cursor..)?, source).map(|i| i as isize)
    }

    fn first_words(&self) -> Option<FirstWords> {
        Pattern::first_words(self)
    }
}
