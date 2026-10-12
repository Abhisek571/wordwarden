// Word-pair counts from news text ("the form of" is common, "the from of" is not), packed by
// scripts/context-table.mjs into spelling/pairs.bin; the layout is described there.

export type WordPairs = Readonly<{
  /** How often `word` occurs, or 0 when it is unknown. */
  wordCount(word: string): number;
  /** How often `left` is followed directly by `right`, or 0 when the pair is rare or unknown. */
  pairCount(left: string, right: string): number;
}>;

/** Counts are stored as round(10 × log2(count)) in one byte. */
function decodeCount(byte: number): number {
  return Math.round(2 ** (byte / 10));
}

export const EMPTY_WORD_PAIRS: WordPairs = Object.freeze({
  wordCount: () => 0,
  pairCount: () => 0,
});

export function parseWordPairs(bytes: Uint8Array): WordPairs {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'WWP1') {
    throw new TypeError('Bundled word-pair data has an unknown layout.');
  }
  let offset = 4;
  const vocabularyLength = view.getUint32(offset, true);
  offset += 4;
  const vocabulary = new TextDecoder('latin1').decode(bytes.subarray(offset, offset + vocabularyLength)).split('\n');
  offset += vocabularyLength;
  const ids = new Map<string, number>(vocabulary.map((word, id) => [word, id]));
  const wordCounts = bytes.slice(offset, offset + vocabulary.length);
  offset += vocabulary.length;
  const pairTotal = view.getUint32(offset, true);
  const rowTotal = view.getUint32(offset + 4, true);
  offset += 8;

  function readVarint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = bytes[offset] ?? 0;
      offset += 1;
      value += (byte & 127) * scale;
      if (byte < 128) return value;
      scale *= 128;
    }
  }

  // Each word's pairs sit in one run of `rightIds`, sorted by id, found through `rowStart`.
  const rowStart = new Uint32Array(vocabulary.length + 1);
  const rightIds = new Uint32Array(pairTotal);
  const pairCounts = new Uint8Array(pairTotal);
  let left = 0;
  let pair = 0;
  for (let row = 0; row < rowTotal; row += 1) {
    left += readVarint();
    const size = readVarint();
    rowStart[left] = pair;
    rowStart[left + 1] = pair + size;
    let right = 0;
    for (let index = 0; index < size; index += 1) {
      right += readVarint();
      rightIds[pair] = right;
      pairCounts[pair] = bytes[offset] ?? 0;
      offset += 1;
      pair += 1;
    }
  }
  // Words without a row of their own get an empty run.
  for (let id = 1; id <= vocabulary.length; id += 1) {
    if ((rowStart[id] ?? 0) < (rowStart[id - 1] ?? 0)) rowStart[id] = rowStart[id - 1] ?? 0;
  }

  function wordCount(word: string): number {
    const id = ids.get(word);
    return id === undefined ? 0 : decodeCount(wordCounts[id] ?? 0);
  }

  function pairCount(leftWord: string, rightWord: string): number {
    const leftId = ids.get(leftWord);
    const rightId = ids.get(rightWord);
    if (leftId === undefined || rightId === undefined) return 0;
    let low = rowStart[leftId] ?? 0;
    let high = rowStart[leftId + 1] ?? 0;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      const found = rightIds[middle] ?? 0;
      if (found === rightId) return decodeCount(pairCounts[middle] ?? 0);
      if (found < rightId) low = middle + 1;
      else high = middle;
    }
    return 0;
  }

  return Object.freeze({ wordCount, pairCount });
}
