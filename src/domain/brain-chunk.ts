import type { KnowledgeScope } from "./scope.js";

export const EMBEDDING_STATUSES = ["pending", "processing", "ready", "failed"] as const;
export type EmbeddingStatus = (typeof EMBEDDING_STATUSES)[number];

export const KNOWLEDGE_ORIGINS = ["source", "memory"] as const;
export type KnowledgeOrigin = (typeof KNOWLEDGE_ORIGINS)[number];

export type BrainChunk = {
  chunkId: string;
  sourceId: string;
  originType: KnowledgeOrigin;
  memoryId?: string;
  memoryVersion?: number;
  organizationId: string;
  scope: KnowledgeScope;
  text: string;
  position: number;
  page?: number;
  section?: string;
  metadata: Record<string, unknown>;
  knowledgeVersion: number;
  embeddingStatus: EmbeddingStatus;
  embedding?: number[];
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingError?: string;
  embeddedAt?: Date;
  createdAt: Date;
};
