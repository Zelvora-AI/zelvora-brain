export type RetrievalJudgment = {
  retrievedIds: string[];
  relevantIds: string[];
};

export type RetrievalMetrics = {
  precisionAtK: number;
  recallAtK: number;
  reciprocalRank: number;
};

export function evaluateRetrieval(
  judgment: RetrievalJudgment,
  k = judgment.retrievedIds.length,
): RetrievalMetrics {
  if (!Number.isInteger(k) || k < 1) throw new Error("k must be a positive integer");
  const retrieved = judgment.retrievedIds.slice(0, k);
  const relevant = new Set(judgment.relevantIds);
  const relevantRetrieved = retrieved.filter((id) => relevant.has(id));
  const firstRelevantIndex = retrieved.findIndex((id) => relevant.has(id));

  return {
    precisionAtK: relevantRetrieved.length / k,
    recallAtK: relevant.size === 0 ? 0 : relevantRetrieved.length / relevant.size,
    reciprocalRank: firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1),
  };
}

export function meanReciprocalRank(metrics: RetrievalMetrics[]): number {
  if (metrics.length === 0) return 0;
  return metrics.reduce((sum, metric) => sum + metric.reciprocalRank, 0) / metrics.length;
}
