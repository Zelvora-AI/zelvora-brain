export type MetadataValue = string | number | boolean | null;
export type Metadata = Record<string, MetadataValue>;

export type SourceDocument = {
  id: string;
  text: string;
  title?: string;
  metadata?: Metadata;
};

export type Chunk = {
  id: string;
  documentId: string;
  text: string;
  position: number;
  title?: string;
  section?: string;
  page?: number;
  metadata?: Metadata;
};

export type ScoredChunk = {
  chunk: Chunk;
  score: number;
  rank: number;
};

export type ChunkFilter = (chunk: Chunk) => boolean;
