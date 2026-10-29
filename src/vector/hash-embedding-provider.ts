import { tokenize } from "../lexical/tokenize.js";
import type { EmbeddingProvider } from "./embedding-provider.js";

/**
 * Deterministic feature hashing for examples and acceptance checks.
 * This is not a semantic embedding model.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions = 128) {
    if (!Number.isInteger(dimensions) || dimensions < 8 || dimensions > 4_096) {
      throw new Error("Embedding dimensions must be an integer from 8 to 4096");
    }
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embed(text));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  private embed(text: string): number[] {
    const vector = Array.from<number>({ length: this.dimensions }).fill(0);
    for (const token of tokenize(text)) {
      const hash = fnv1a(token);
      const index = hash % this.dimensions;
      const sign = (hash & 1) === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
    return normalize(vector);
  }
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}
