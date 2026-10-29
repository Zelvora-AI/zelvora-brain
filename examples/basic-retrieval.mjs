import { readFile } from "node:fs/promises";
import {
  HashEmbeddingProvider,
  HybridRetriever,
  InMemoryVectorStore,
  buildCitations,
  chunkMarkdown,
  formatCitations,
} from "../dist/index.js";

const documents = JSON.parse(
  await readFile(new URL("../fixtures/synthetic/documents.json", import.meta.url), "utf8"),
);
const chunks = documents.flatMap((document) =>
  chunkMarkdown(document, { size: 300, overlap: 40 }),
);

const retriever = new HybridRetriever({
  embeddingProvider: new HashEmbeddingProvider(128),
  vectorStore: new InMemoryVectorStore(),
});

await retriever.add(chunks);
const results = await retriever.search("When can an unopened product be returned?", {
  limit: 3,
});

for (const result of results) {
  console.log(`${result.rank}. ${result.chunk.title} — ${result.chunk.section}`);
  console.log(`   score=${result.score.toFixed(4)} channels=${Object.keys(result.channels).join(",")}`);
}

console.log("\nCitations");
console.log(formatCitations(buildCitations(results)));
