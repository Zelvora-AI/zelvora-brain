import { Bm25Index } from "../lexical/bm25.js";
import type { Chunk, ChunkFilter, ScoredChunk } from "../types.js";
import type { EmbeddingProvider } from "../vector/embedding-provider.js";
import { InMemoryVectorStore } from "../vector/in-memory-vector-store.js";
import {
  reciprocalRankFusion,
  type FusedChunk,
} from "./reciprocal-rank-fusion.js";

export type HybridRetrieverOptions = {
  lexical?: Bm25Index;
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: InMemoryVectorStore;
};

export type HybridSearchOptions = {
  limit?: number;
  candidateLimit?: number;
  filter?: ChunkFilter;
  rrfK?: number;
};

export class HybridRetriever {
  private readonly lexical: Bm25Index;
  private readonly embeddingProvider: EmbeddingProvider | undefined;
  private readonly vectorStore: InMemoryVectorStore | undefined;

  constructor(options: HybridRetrieverOptions = {}) {
    this.lexical = options.lexical ?? new Bm25Index();
    this.embeddingProvider = options.embeddingProvider;
    this.vectorStore = options.vectorStore;
    if (Boolean(this.embeddingProvider) !== Boolean(this.vectorStore)) {
      throw new Error("embeddingProvider and vectorStore must be configured together");
    }
  }

  async add(chunks: Chunk[]): Promise<void> {
    this.lexical.add(chunks);
    if (this.embeddingProvider && this.vectorStore) {
      const embeddings = await this.embeddingProvider.embedDocuments(
        chunks.map((chunk) => chunk.text),
      );
      this.vectorStore.add(chunks, embeddings);
    }
  }

  async search(query: string, options: HybridSearchOptions = {}): Promise<FusedChunk[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("Search query is required");
    const limit = options.limit ?? 10;
    const candidateLimit = options.candidateLimit ?? Math.max(limit * 3, 20);
    if (!Number.isInteger(candidateLimit) || candidateLimit < limit || candidateLimit > 1_000) {
      throw new Error("candidateLimit must be an integer from limit to 1000");
    }

    const lexical = this.lexical.search(normalizedQuery, {
      limit: candidateLimit,
      ...(options.filter ? { filter: options.filter } : {}),
    });
    let vector: ScoredChunk[] = [];
    if (this.embeddingProvider && this.vectorStore) {
      const queryEmbedding = await this.embeddingProvider.embedQuery(normalizedQuery);
      vector = this.vectorStore.search(queryEmbedding, {
        limit: candidateLimit,
        ...(options.filter ? { filter: options.filter } : {}),
      });
    }

    return reciprocalRankFusion(
      { lexical, ...(vector.length > 0 ? { vector } : {}) },
      { limit, ...(options.rrfK === undefined ? {} : { k: options.rrfK }) },
    );
  }

  clear(): void {
    this.lexical.clear();
    this.vectorStore?.clear();
  }
}
