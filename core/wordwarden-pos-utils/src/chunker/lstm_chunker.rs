use hashbrown::HashMap;

use crate::{UPOS, chunker::Chunker};

/// The vocabulary index of words the model has not seen.
const UNK_IDX: usize = 1;
const WORD_DIM: usize = 6;
const UPOS_DIM: usize = 8;
/// The tag embedding has a row for "no tag", one for "unknown" and one per tag.
const UPOS_ROWS: usize = 20;
const INPUT: usize = WORD_DIM + UPOS_DIM;
const HIDDEN: usize = INPUT;
const MAGIC: &[u8; 8] = b"WWNPLSTM";

/// The weights of one direction of the LSTM. Each gate has its input and hidden weights, stored as `[from][to]`;
/// the gates are, in order, input, forget, output and cell.
struct Direction {
    input_weights: [[[f32; HIDDEN]; INPUT]; 4],
    hidden_weights: [[[f32; HIDDEN]; HIDDEN]; 4],
}

/// A [`Chunker`] that finds noun phrases with a small bidirectional LSTM over word and tag embeddings.
///
/// The model was trained with the Burn framework. This computes what Burn computed from the same weights, in the
/// same order of operations, so the results match to the bit: every sum starts at zero and adds its terms in order,
/// the sigmoid is `exp(-ln(exp(-x) + 1))` in single precision, and the hyperbolic tangent is taken in double
/// precision.
pub struct LstmChunker {
    vocab: HashMap<String, usize>,
    word_embeddings: Vec<[f32; WORD_DIM]>,
    upos_embeddings: [[f32; UPOS_DIM]; UPOS_ROWS],
    forward: Direction,
    reverse: Direction,
    output_weights: [f32; 2 * HIDDEN],
    output_bias: f32,
}

/// Reads little-endian `f32`s from the weights file.
struct Reader<'a> {
    bytes: &'a [u8],
}

impl Reader<'_> {
    fn f32(&mut self) -> f32 {
        let (value, rest) = self.bytes.split_at(4);
        self.bytes = rest;
        f32::from_le_bytes(value.try_into().unwrap())
    }

    fn u32(&mut self) -> u32 {
        let (value, rest) = self.bytes.split_at(4);
        self.bytes = rest;
        u32::from_le_bytes(value.try_into().unwrap())
    }

    fn array<const N: usize>(&mut self) -> [f32; N] {
        std::array::from_fn(|_| self.f32())
    }

    fn direction(&mut self) -> Direction {
        let mut input_weights = [[[0.; HIDDEN]; INPUT]; 4];
        let mut hidden_weights = [[[0.; HIDDEN]; HIDDEN]; 4];
        for gate in 0..4 {
            for row in &mut input_weights[gate] {
                *row = self.array();
            }
            for row in &mut hidden_weights[gate] {
                *row = self.array();
            }
        }
        Direction {
            input_weights,
            hidden_weights,
        }
    }
}

impl LstmChunker {
    /// Loads the model from its weights file and its vocabulary, a JSON object from words to rows of the word
    /// embedding.
    ///
    /// The weights file holds the magic bytes `WWNPLSTM`; the shape as little-endian `u32`s (words in the vocabulary,
    /// word embedding size, tag rows, tag embedding size, hidden size); then little-endian `f32`s: the word embedding
    /// and the tag embedding by row; for the forward and then the reverse direction, for each gate (input, forget,
    /// output, cell), its input and then its hidden weights by `from` row; the output weights; and the output bias.
    /// It was converted from the Burn model Harper trained.
    pub fn load_from_bytes(weights: impl AsRef<[u8]>, vocab: impl AsRef<[u8]>) -> Self {
        let weights = weights.as_ref();
        assert!(weights.starts_with(MAGIC), "not a chunker weights file");
        let mut reader = Reader {
            bytes: &weights[MAGIC.len()..],
        };
        let shape = [
            reader.u32(),
            reader.u32(),
            reader.u32(),
            reader.u32(),
            reader.u32(),
        ];
        let words = shape[0] as usize;
        assert_eq!(
            shape[1..],
            [
                WORD_DIM as u32,
                UPOS_ROWS as u32,
                UPOS_DIM as u32,
                HIDDEN as u32
            ],
            "unexpected chunker model shape"
        );
        let word_embeddings = (0..words).map(|_| reader.array()).collect();
        let upos_embeddings = std::array::from_fn(|_| reader.array());
        let forward = reader.direction();
        let reverse = reader.direction();
        let output_weights = reader.array();
        let output_bias = reader.f32();
        assert!(reader.bytes.is_empty(), "chunker weights file is too long");
        let vocab: HashMap<String, usize> = serde_json::from_slice(vocab.as_ref()).unwrap();
        Self {
            vocab,
            word_embeddings,
            upos_embeddings,
            forward,
            reverse,
            output_weights,
            output_bias,
        }
    }

    /// The model's score for each token being part of a noun phrase; above 0.5 means it is.
    pub fn scores(&self, sentence: &[String], tags: &[Option<UPOS>]) -> Vec<f32> {
        let inputs: Vec<[f32; INPUT]> = sentence
            .iter()
            .zip(tags)
            .map(|(word, tag)| {
                let word_row = *self.vocab.get(word).unwrap_or(&UNK_IDX);
                let tag_row = tag.map(|tag| tag as usize + 2).unwrap_or(1);
                let mut input = [0.; INPUT];
                input[..WORD_DIM].copy_from_slice(&self.word_embeddings[word_row]);
                input[WORD_DIM..].copy_from_slice(&self.upos_embeddings[tag_row]);
                input
            })
            .collect();

        let forward = run_direction(&self.forward, inputs.iter());
        let mut reverse = run_direction(&self.reverse, inputs.iter().rev());
        reverse.reverse();

        forward
            .iter()
            .zip(&reverse)
            .map(|(forward, reverse)| {
                let mut sum = 0.0f32;
                for (value, weight) in forward.iter().chain(reverse).zip(&self.output_weights) {
                    sum += value * weight;
                }
                sum + self.output_bias
            })
            .collect()
    }
}

/// The hidden state after each input of one direction of the LSTM.
fn run_direction<'a>(
    direction: &Direction,
    inputs: impl Iterator<Item = &'a [f32; INPUT]>,
) -> Vec<[f32; HIDDEN]> {
    let mut hidden = [0.0f32; HIDDEN];
    let mut cell = [0.0f32; HIDDEN];
    let mut out = Vec::new();
    for input in inputs {
        let gate = |index: usize| -> [f32; HIDDEN] {
            let from_input = product(input, &direction.input_weights[index]);
            let from_hidden = product(&hidden, &direction.hidden_weights[index]);
            std::array::from_fn(|j| from_input[j] + from_hidden[j])
        };
        let [input_gate, forget_gate, output_gate, cell_gate] =
            [gate(0), gate(1), gate(2), gate(3)];
        for j in 0..HIDDEN {
            let forget = sigmoid(forget_gate[j]);
            let add = sigmoid(input_gate[j]);
            let candidate = tanh(cell_gate[j]);
            cell[j] = forget * cell[j] + add * candidate;
        }
        for j in 0..HIDDEN {
            hidden[j] = sigmoid(output_gate[j]) * tanh(cell[j]);
        }
        out.push(hidden);
    }
    out
}

/// `values` times the matrix `weights` (`[from][to]`), each sum starting at zero and adding its terms in order.
fn product<const FROM: usize>(
    values: &[f32; FROM],
    weights: &[[f32; HIDDEN]; FROM],
) -> [f32; HIDDEN] {
    let mut out = [0.0f32; HIDDEN];
    for (value, row) in values.iter().zip(weights) {
        for (sum, weight) in out.iter_mut().zip(row) {
            *sum += value * weight;
        }
    }
    out
}

// Burn negates by multiplying by -1, and this follows it step by step.
#[allow(clippy::neg_multiply)]
fn sigmoid(x: f32) -> f32 {
    let log_term = ((x * -1.0).exp() + 1.0).ln();
    (log_term * -1.0).exp()
}

fn tanh(x: f32) -> f32 {
    (x as f64).tanh() as f32
}

impl Chunker for LstmChunker {
    fn chunk_sentence(&self, sentence: &[String], tags: &[Option<UPOS>]) -> Vec<bool> {
        self.scores(sentence, tags)
            .into_iter()
            .map(|score| score > 0.5)
            .collect()
    }
}
