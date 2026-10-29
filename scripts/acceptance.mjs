import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  Bm25Index,
  HashEmbeddingProvider,
  HybridRetriever,
  InMemoryVectorStore,
  buildCitations,
  chunkMarkdown,
  evaluateRetrieval,
  formatCitations,
  meanReciprocalRank,
} from "../dist/index.js";

const documents = JSON.parse(
  await readFile(new URL("../fixtures/synthetic/documents.json", import.meta.url), "utf8"),
);
const chunks = documents.flatMap((document) =>
  chunkMarkdown(document, { size: 300, overlap: 40 }),
);

assert.ok(chunks.length >= documents.length);
assert.ok(chunks.some((chunk) => chunk.section === "Returns"));
assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);

const lexical = new Bm25Index();
lexical.add(chunks);
const lexicalResults = lexical.search("unopened products return", { limit: 3 });
assert.equal(lexicalResults[0]?.chunk.documentId, "returns-policy");

const retriever = new HybridRetriever({
  embeddingProvider: new HashEmbeddingProvider(64),
  vectorStore: new InMemoryVectorStore(),
});
await retriever.add(chunks);

const hybridResults = await retriever.search("return an unopened product", { limit: 3 });
assert.equal(hybridResults[0]?.chunk.documentId, "returns-policy");
assert.ok(hybridResults[0]?.channels.lexical);
assert.ok(hybridResults[0]?.channels.vector);

const filtered = await retriever.search("delivery", {
  limit: 3,
  filter: (chunk) => chunk.metadata?.category === "operations",
});
assert.ok(filtered.length > 0);
assert.ok(filtered.every((result) => result.chunk.metadata?.category === "operations"));

const citations = buildCitations(hybridResults, [hybridResults[0].chunk.id]);
assert.match(formatCitations(citations), /Returns Policy/);
assert.throws(
  () => buildCitations(hybridResults, ["missing:0"]),
  /was not retrieved/,
);

const metrics = evaluateRetrieval({
  retrievedIds: hybridResults.map((result) => result.chunk.documentId),
  relevantIds: ["returns-policy"],
}, 3);
assert.equal(metrics.reciprocalRank, 1);
assert.equal(meanReciprocalRank([metrics]), 1);

console.log(`Acceptance passed: ${chunks.length} chunks, ${hybridResults.length} hybrid results`);
