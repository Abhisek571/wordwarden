use std::num::NonZero;
use std::rc::Rc;
use std::sync::{Arc, LazyLock};

pub use wordwarden_pos_utils::{
    BrillChunker, BrillTagger, CachedChunker, Chunker, FreqDict, LstmChunker, Tagger, UPOS,
};

const BRILL_TAGGER_SOURCE: &str = include_str!("../trained_tagger_model.json");

static BRILL_TAGGER: LazyLock<Arc<BrillTagger<FreqDict>>> =
    LazyLock::new(|| Arc::new(uncached_brill_tagger()));

fn uncached_brill_tagger() -> BrillTagger<FreqDict> {
    serde_json::from_str(BRILL_TAGGER_SOURCE).unwrap()
}

/// Get a copy of a shared, lazily-initialized [`BrillTagger`]. There will be only one instance
/// per-process.
pub fn brill_tagger() -> Arc<BrillTagger<FreqDict>> {
    (*BRILL_TAGGER).clone()
}

const BRILL_CHUNKER_SOURCE: &str = include_str!("../trained_chunker_model.json");

static BRILL_CHUNKER: LazyLock<Arc<BrillChunker>> =
    LazyLock::new(|| Arc::new(uncached_brill_chunker()));

fn uncached_brill_chunker() -> BrillChunker {
    serde_json::from_str(BRILL_CHUNKER_SOURCE).unwrap()
}

/// Get a copy of a shared, lazily-initialized [`BrillChunker`]. There will be only one instance
/// per-process.
pub fn brill_chunker() -> Arc<BrillChunker> {
    (*BRILL_CHUNKER).clone()
}

const NP_CHUNKER_VOCAB: &[u8] = include_bytes!("../finished_chunker/vocab.json");
const NP_CHUNKER_WEIGHTS: &[u8] = include_bytes!("../finished_chunker/weights.bin");

thread_local! {
    static NP_CHUNKER: Rc<CachedChunker<LstmChunker>> = Rc::new(uncached_np_chunker());
}

fn uncached_np_chunker() -> CachedChunker<LstmChunker> {
    CachedChunker::new(
        LstmChunker::load_from_bytes(NP_CHUNKER_WEIGHTS, NP_CHUNKER_VOCAB),
        NonZero::new(10000).unwrap(),
    )
}

/// Get a copy of the shared, lazily-initialized noun-phrase chunker. There will be only one instance
/// per-thread. Its results are memoized, since it runs on every sentence.
pub fn np_chunker() -> Rc<CachedChunker<LstmChunker>> {
    NP_CHUNKER.with(|c| c.clone())
}
