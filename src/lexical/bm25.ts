import type { Chunk, ChunkFilter, ScoredChunk } from "../types.js";
import { tokenize } from "./tokenize.js";

export type Bm25Options = {
  k1?: number;
  b?: number;
};

export type SearchOptions = {
  limit?: number;
  filter?: ChunkFilter;
};

type IndexedChunk = {
  chunk: Chunk;
  length: number;
  frequencies: Map<string, number>;
};

export class Bm25Index {
  private readonly documents = new Map<string, IndexedChunk>();
  private readonly documentFrequency = new Map<string, number>();
  private readonly k1: number;
  private readonly b: number;
  private totalLength = 0;

  constructor(options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    if (this.k1 <= 0) throw new Error("BM25 k1 must be greater than zero");
    if (this.b < 0 || this.b > 1) throw new Error("BM25 b must be between zero and one");
  }

  add(chunks: Chunk[]): void {
    for (const chunk of chunks) {
      if (this.documents.has(chunk.id)) throw new Error(`Duplicate chunk ID: ${chunk.id}`);
      const tokens = tokenize(chunk.text);
      const frequencies = countTokens(tokens);
      this.documents.set(chunk.id, { chunk, length: tokens.length, frequencies });
      this.totalLength += tokens.length;
      for (const token of frequencies.keys()) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
    }
  }

  search(query: string, options: SearchOptions = {}): ScoredChunk[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0 || this.documents.size === 0) return [];
    const limit = normalizeLimit(options.limit);
    const averageLength = this.totalLength / this.documents.size || 1;
    const scored: Array<Omit<ScoredChunk, "rank">> = [];

    for (const indexed of this.documents.values()) {
      if (options.filter && !options.filter(indexed.chunk)) continue;
      let score = 0;
      for (const term of terms) {
        const frequency = indexed.frequencies.get(term) ?? 0;
        if (frequency === 0) continue;
        const documentsWithTerm = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(
          1 + (this.documents.size - documentsWithTerm + 0.5) / (documentsWithTerm + 0.5),
        );
        const lengthNormalization = 1 - this.b + this.b * (indexed.length / averageLength);
        score += idf * ((frequency * (this.k1 + 1)) / (frequency + this.k1 * lengthNormalization));
      }
      if (score > 0) scored.push({ chunk: indexed.chunk, score });
    }

    return scored
      .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, limit)
      .map((result, index) => ({ ...result, rank: index + 1 }));
  }

  clear(): void {
    this.documents.clear();
    this.documentFrequency.clear();
    this.totalLength = 0;
  }

  get size(): number {
    return this.documents.size;
  }
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function normalizeLimit(limit = 10): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Search limit must be an integer from 1 to 1000");
  }
  return limit;
}
