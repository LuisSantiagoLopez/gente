// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

/**
 * A small ranked word index over one chat's messages (BM25). Messages are added once, in sequence
 * order, so a long chat is indexed a little at a time. A search only reads the posting lists of the
 * words it asks about, so it stays fast however long the chat grows.
 */

const K1 = 1.2;
const B = 0.75;

const STOP_WORDS = new Set(
  (
    "a an and are as at be but by do does did for from had has have he her his i if in into is it its " +
    "me my no not of on or our she so than that the their them then there they this to was we were " +
    "what when where which who why will with you your about can could would should just also " +
    "el la los las un una unos unas y o de del al en que es son por para con sin se su sus lo le les " +
    "mi mis tu tus me te nos como pero mas más muy ya si sí no qué cual cuál fue era ser esta este esto"
  ).split(" "),
);

/** Lowercase, accents removed, light suffix stemming. Han, kana and Hangul are one token per character. */
export function indexTokens(text: string): string[] {
  const folded = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const tokens: string[] = [];
  for (const match of folded.matchAll(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu,
  )) {
    const word = match[0];
    if (word.length === 1 && /[a-z0-9]/.test(word)) continue;
    if (STOP_WORDS.has(word)) continue;
    tokens.push(stem(word));
  }
  return tokens;
}

function stem(word: string): string {
  if (word.length <= 4 || /\d/.test(word)) return word;
  for (const suffix of ["ing", "edly", "ed", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3)
      return word.slice(0, -suffix.length);
  }
  return word;
}

export type HistoryIndexHit = { seq: number; score: number };

export class HistoryIndex {
  private readonly postings = new Map<string, Map<number, number>>();
  private readonly lengths = new Map<number, number>();
  private totalLength = 0;
  /** Highest sequence added; later messages are added after it. */
  upToSeq = -1;

  get size(): number {
    return this.lengths.size;
  }

  add(seq: number, text: string): void {
    if (this.lengths.has(seq)) return;
    const tokens = indexTokens(text);
    this.lengths.set(seq, tokens.length);
    this.totalLength += tokens.length;
    if (seq > this.upToSeq) this.upToSeq = seq;
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    for (const [token, count] of counts) {
      let list = this.postings.get(token);
      if (!list) {
        list = new Map();
        this.postings.set(token, list);
      }
      list.set(seq, count);
    }
  }

  /** The best matches below `beforeSeq`, best first; ties go to the earlier message. */
  search(query: string, options: { beforeSeq: number; limit: number; minScore?: number }) {
    const terms = [...new Set(indexTokens(query))];
    const documents = this.lengths.size;
    if (!terms.length || !documents) return [] as HistoryIndexHit[];
    const averageLength = this.totalLength / documents || 1;
    const scores = new Map<number, number>();
    for (const term of terms) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = Math.log(1 + (documents - list.size + 0.5) / (list.size + 0.5));
      for (const [seq, frequency] of list) {
        if (seq >= options.beforeSeq) continue;
        const length = this.lengths.get(seq) ?? 0;
        const weight =
          (idf * frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / averageLength));
        scores.set(seq, (scores.get(seq) ?? 0) + weight);
      }
    }
    const minScore = options.minScore ?? 0;
    return [...scores]
      .filter(([, score]) => score > minScore)
      .sort((left, right) => right[1] - left[1] || left[0] - right[0])
      .slice(0, options.limit)
      .map(([seq, score]) => ({ seq, score }));
  }
}
