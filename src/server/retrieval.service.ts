import { buildCitations } from "../citations/citations.js";
import { chunkMarkdown, chunkText } from "../chunking/chunk.js";
import { HybridRetriever } from "../hybrid/hybrid-retriever.js";
import type { FusedChunk } from "../hybrid/reciprocal-rank-fusion.js";
import type { Metadata } from "../types.js";
import { HashEmbeddingProvider } from "../vector/hash-embedding-provider.js";
import { InMemoryVectorStore } from "../vector/in-memory-vector-store.js";
import type { MongoDocumentRepository } from "./document.repository.js";

export type RetrievalServiceOptions = {
  chunkSize: number;
  chunkOverlap: number;
  embeddingDimensions: number;
};

export type RetrievalSearchInput = {
  query: string;
  limit: number;
  metadata?: Metadata;
};

export class RetrievalService {
  private retriever: HybridRetriever;
  private refreshQueue: Promise<void> = Promise.resolve();
  private documentCount = 0;
  private chunkCount = 0;
  private refreshedAt?: Date;

  constructor(
    private readonly repository: MongoDocumentRepository,
    private readonly options: RetrievalServiceOptions,
  ) {
    this.retriever = this.createRetriever();
  }

  async refresh(): Promise<{ documents: number; chunks: number }> {
    const operation = this.refreshQueue.then(async () => {
      const documents = await this.repository.listAll();
      const chunks = documents.flatMap((document) => {
        const input = {
          id: document.id,
          text: document.text,
          format: document.format,
          ...(document.title ? { title: document.title } : {}),
          ...(document.metadata ? { metadata: document.metadata } : {}),
        };
        return document.format === "markdown"
          ? chunkMarkdown(input, this.chunkOptions)
          : chunkText(input, this.chunkOptions);
      });
      const next = this.createRetriever();
      await next.add(chunks);
      this.retriever = next;
      this.documentCount = documents.length;
      this.chunkCount = chunks.length;
      this.refreshedAt = new Date();
    });
    this.refreshQueue = operation.catch(() => undefined);
    await operation;
    return { documents: this.documentCount, chunks: this.chunkCount };
  }

  async search(input: RetrievalSearchInput): Promise<{
    results: FusedChunk[];
    citations: ReturnType<typeof buildCitations>;
  }> {
    await this.refreshQueue;
    const results = await this.retriever.search(input.query, {
      limit: input.limit,
      ...(input.metadata ? { filter: metadataFilter(input.metadata) } : {}),
    });
    return { results, citations: buildCitations(results) };
  }

  stats() {
    return {
      documents: this.documentCount,
      chunks: this.chunkCount,
      ...(this.refreshedAt ? { refreshedAt: this.refreshedAt.toISOString() } : {}),
    };
  }

  private createRetriever(): HybridRetriever {
    return new HybridRetriever({
      embeddingProvider: new HashEmbeddingProvider(this.options.embeddingDimensions),
      vectorStore: new InMemoryVectorStore(),
    });
  }

  private get chunkOptions() {
    return { size: this.options.chunkSize, overlap: this.options.chunkOverlap };
  }
}

function metadataFilter(expected: Metadata) {
  return (chunk: { metadata?: Metadata }) =>
    Object.entries(expected).every(([key, value]) => chunk.metadata?.[key] === value);
}
