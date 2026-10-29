import type { FusedChunk } from "../hybrid/reciprocal-rank-fusion.js";
import type { ScoredChunk } from "../types.js";

export type Citation = {
  number: number;
  chunkId: string;
  documentId: string;
  title?: string;
  section?: string;
  page?: number;
};

type RetrievalResult = FusedChunk | ScoredChunk;

export function buildCitations(
  results: RetrievalResult[],
  selectedChunkIds: string[] = results.map((result) => result.chunk.id),
): Citation[] {
  const byChunkId = new Map(results.map((result) => [result.chunk.id, result.chunk]));
  const seen = new Set<string>();

  return selectedChunkIds.map((chunkId, index) => {
    if (seen.has(chunkId)) throw new Error(`Duplicate citation chunk ID: ${chunkId}`);
    seen.add(chunkId);
    const chunk = byChunkId.get(chunkId);
    if (!chunk) throw new Error(`Citation references a chunk that was not retrieved: ${chunkId}`);
    return {
      number: index + 1,
      chunkId,
      documentId: chunk.documentId,
      ...(chunk.title ? { title: chunk.title } : {}),
      ...(chunk.section ? { section: chunk.section } : {}),
      ...(chunk.page === undefined ? {} : { page: chunk.page }),
    };
  });
}

export function formatCitations(
  citations: Citation[],
  format: "markdown" | "text" = "markdown",
): string {
  return citations
    .map((citation) => {
      const location = [
        citation.title ?? citation.documentId,
        citation.section,
        citation.page === undefined ? undefined : `page ${citation.page}`,
      ].filter(Boolean).join(", ");
      return format === "markdown"
        ? `[${citation.number}] ${location} (${citation.chunkId})`
        : `${citation.number}. ${location} (${citation.chunkId})`;
    })
    .join("\n");
}
