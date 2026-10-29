import { Bm25Index } from "../lexical/bm25.js";
import type { BrainChunk } from "../domain/brain-chunk.js";
import type {
  HybridCandidateSet,
  RankedLexicalCandidate,
  RankedSemanticCandidate,
  RetrieveChunksInput,
} from "./contracts.js";
import type { BrainChunkRepository } from "../storage/brain-chunk.repository.js";

export class ChunkRetrievalService {
  constructor(
    private readonly repository: BrainChunkRepository,
    private readonly maxCandidateChunks: number,
  ) {}

  async retrieve(input: RetrieveChunksInput): Promise<HybridCandidateSet> {
    const query = input.query.trim().replace(/\s+/g, " ");
    const limit = input.limitPerChannel ?? 40;
    if (!query) throw requestError("query is required");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw requestError("limitPerChannel must be an integer from 1 to 50");
    }

    const chunks = await this.repository.findVisible(input.context, this.maxCandidateChunks);
    const lexical = lexicalCandidates(chunks, query, limit);
    const semantic = input.queryVector
      ? semanticCandidates(chunks, input.queryVector, limit)
      : [];
    return {
      semantic,
      lexical,
      channels: { semantic: Boolean(input.queryVector), lexical: true },
    };
  }
}

function lexicalCandidates(
  chunks: BrainChunk[],
  query: string,
  limit: number,
): RankedLexicalCandidate[] {
  const index = new Bm25Index();
  const byChunkId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  index.add(chunks.map((chunk) => ({
    id: chunk.chunkId,
    documentId: chunk.sourceId,
    text: chunk.text,
    position: chunk.position,
    ...(chunk.page === undefined ? {} : { page: chunk.page }),
    ...(chunk.section === undefined ? {} : { section: chunk.section }),
    metadata: chunk.metadata,
  })));
  return index.search(query, { limit }).map((result) => {
    const chunk = byChunkId.get(result.chunk.id)!;
    return {
      ...candidateView(chunk),
      score: result.score,
      channel: "lexical" as const,
      rank: result.rank,
    };
  });
}

function semanticCandidates(
  chunks: BrainChunk[],
  queryVector: number[],
  limit: number,
): RankedSemanticCandidate[] {
  if (queryVector.length === 0 || queryVector.some((value) => !Number.isFinite(value))) {
    throw requestError("queryVector must contain finite numeric values");
  }
  return chunks
    .filter((chunk) => chunk.embedding?.length === queryVector.length)
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryVector, chunk.embedding!) }))
    .sort((left, right) => right.score - left.score || left.chunk.chunkId.localeCompare(right.chunk.chunkId))
    .slice(0, limit)
    .map(({ chunk, score }, index) => ({
      ...candidateView(chunk),
      score,
      channel: "semantic" as const,
      rank: index + 1,
    }));
}

function candidateView(chunk: BrainChunk) {
  return {
    chunkId: chunk.chunkId,
    sourceId: chunk.sourceId,
    originType: chunk.originType,
    ...(chunk.memoryId ? { memoryId: chunk.memoryId } : {}),
    ...(chunk.memoryVersion ? { memoryVersion: chunk.memoryVersion } : {}),
    text: chunk.text,
    ...(chunk.page === undefined ? {} : { page: chunk.page }),
    ...(chunk.section === undefined ? {} : { section: chunk.section }),
    metadata: chunk.metadata,
  };
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

function requestError(message: string) {
  return Object.assign(new Error(message), { status: 400, code: "INVALID_RETRIEVAL_REQUEST" });
}
