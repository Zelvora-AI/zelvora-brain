import type { Chunk, ChunkFilter, ScoredChunk } from "../types.js";

export type VectorSearchOptions = {
  limit?: number;
  filter?: ChunkFilter;
};

type VectorRecord = {
  chunk: Chunk;
  embedding: number[];
};

export class InMemoryVectorStore {
  private readonly records = new Map<string, VectorRecord>();
  private dimensions: number | undefined;

  add(chunks: Chunk[], embeddings: number[][]): void {
    if (chunks.length !== embeddings.length) {
      throw new Error("Each chunk must have one embedding");
    }

    chunks.forEach((chunk, index) => {
      const embedding = embeddings[index];
      if (!embedding) throw new Error(`Missing embedding for chunk: ${chunk.id}`);
      this.validateEmbedding(embedding);
      if (this.records.has(chunk.id)) throw new Error(`Duplicate chunk ID: ${chunk.id}`);
      this.records.set(chunk.id, { chunk, embedding: [...embedding] });
    });
  }

  search(queryEmbedding: number[], options: VectorSearchOptions = {}): ScoredChunk[] {
    this.validateEmbedding(queryEmbedding);
    const limit = options.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("Search limit must be an integer from 1 to 1000");
    }

    return [...this.records.values()]
      .filter(({ chunk }) => !options.filter || options.filter(chunk))
      .map(({ chunk, embedding }) => ({ chunk, score: cosineSimilarity(queryEmbedding, embedding) }))
      .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, limit)
      .map((result, index) => ({ ...result, rank: index + 1 }));
  }

  clear(): void {
    this.records.clear();
    this.dimensions = undefined;
  }

  get size(): number {
    return this.records.size;
  }

  private validateEmbedding(embedding: number[]): void {
    if (embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) {
      throw new Error("Embeddings must contain finite numeric values");
    }
    if (this.dimensions === undefined) this.dimensions = embedding.length;
    if (embedding.length !== this.dimensions) {
      throw new Error(`Expected ${this.dimensions} embedding dimensions, received ${embedding.length}`);
    }
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
}
