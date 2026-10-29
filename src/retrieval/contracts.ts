import type { BrainChunk, KnowledgeOrigin } from "../domain/brain-chunk.js";
import type { RetrievalContext } from "../domain/scope.js";

export type VectorSearchResult = {
  chunkId: string;
  sourceId: string;
  originType?: KnowledgeOrigin;
  memoryId?: string;
  memoryVersion?: number;
  text: string;
  page?: number;
  section?: string;
  metadata: Record<string, unknown>;
  score: number;
};

export type LexicalSearchResult = {
  chunkId: string;
  sourceId: string;
  originType: KnowledgeOrigin;
  memoryId?: string;
  memoryVersion?: number;
  text: string;
  page?: number;
  section?: string;
  metadata: Record<string, unknown>;
  score: number;
};

export type RankedSemanticCandidate = VectorSearchResult & {
  channel: "semantic";
  rank: number;
};

export type RankedLexicalCandidate = LexicalSearchResult & {
  channel: "lexical";
  rank: number;
};

export type HybridCandidateSet = {
  semantic: RankedSemanticCandidate[];
  lexical: RankedLexicalCandidate[];
  channels: {
    semantic: boolean;
    lexical: boolean;
  };
};

export type RetrieveChunksInput = {
  context: RetrievalContext;
  query: string;
  queryVector?: number[];
  limitPerChannel?: number;
  vectorMode?: "approximate" | "exact";
};

export type UpsertChunksInput = {
  chunks: BrainChunk[];
};
