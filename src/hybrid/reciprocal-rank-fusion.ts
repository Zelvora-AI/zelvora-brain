import type { Chunk, ScoredChunk } from "../types.js";

export type RetrievalChannelScore = {
  rank: number;
  score: number;
};

export type FusedChunk = {
  chunk: Chunk;
  score: number;
  rank: number;
  channels: Record<string, RetrievalChannelScore>;
};

export type FusionOptions = {
  k?: number;
  limit?: number;
};

export function reciprocalRankFusion(
  rankings: Record<string, ScoredChunk[]>,
  options: FusionOptions = {},
): FusedChunk[] {
  const k = options.k ?? 60;
  const limit = options.limit ?? 10;
  if (!Number.isFinite(k) || k <= 0) throw new Error("RRF k must be greater than zero");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Fusion limit must be an integer from 1 to 1000");
  }

  const fused = new Map<string, Omit<FusedChunk, "rank">>();
  for (const [channel, results] of Object.entries(rankings)) {
    for (const result of results) {
      const existing = fused.get(result.chunk.id) ?? {
        chunk: result.chunk,
        score: 0,
        channels: {},
      };
      existing.score += 1 / (k + result.rank);
      existing.channels[channel] = { rank: result.rank, score: result.score };
      fused.set(result.chunk.id, existing);
    }
  }

  return [...fused.values()]
    .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
    .slice(0, limit)
    .map((result, index) => ({ ...result, rank: index + 1 }));
}
