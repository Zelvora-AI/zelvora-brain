# Zelvora Brain Public

An independent, local retrieval toolkit for TypeScript and JavaScript. It provides deterministic document chunking, BM25 keyword retrieval, in-memory vector search, reciprocal-rank fusion, citation helpers, and retrieval evaluation metrics.

This repository does **not** call a private Zelvora service, contain a hosted API client, or depend on private Brain code. It is designed to work on its own with synthetic data or an embedding provider supplied by the developer.

## Features

- Plain-text and heading-aware Markdown chunking
- Local BM25 keyword index
- Provider-neutral embedding interface
- In-memory cosine-similarity vector store
- Local deterministic hash embeddings for examples and checks
- Hybrid lexical/vector retrieval using Reciprocal Rank Fusion
- Metadata filtering
- Citation validation and formatting
- Precision@K, Recall@K, and Mean Reciprocal Rank helpers
- Zero runtime dependencies

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Install locally

```sh
npm install
npm run check
npm run example
```

After the package is published, consumers can install it with:

```sh
npm install zelvora-brain-public
```

## Basic retrieval

```ts
import {
  HashEmbeddingProvider,
  HybridRetriever,
  InMemoryVectorStore,
  chunkMarkdown,
} from "zelvora-brain-public";

const chunks = chunkMarkdown({
  id: "returns-policy",
  title: "Returns Policy",
  text: "# Returns\nUnopened items may be returned within 30 days.",
});

const retriever = new HybridRetriever({
  embeddingProvider: new HashEmbeddingProvider(),
  vectorStore: new InMemoryVectorStore(),
});

await retriever.add(chunks);
const results = await retriever.search("When can I return an unopened item?", {
  limit: 5,
});
```

`HashEmbeddingProvider` uses deterministic feature hashing so examples run without credentials or network calls. It is not a semantic embedding model. For real semantic retrieval, implement `EmbeddingProvider` using a local model or a provider selected and configured by the application developer.

## Custom embedding provider

```ts
import type { EmbeddingProvider } from "zelvora-brain-public";

class LocalEmbeddingProvider implements EmbeddingProvider {
  async embedDocuments(texts: string[]): Promise<number[][]> {
    return localModel.embed(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await localModel.embed([text]))[0];
  }
}
```

The library does not send text anywhere. Network behavior, credentials, privacy controls, and model licensing are the responsibility of the custom provider implementation.

## Lexical-only retrieval

```ts
import { Bm25Index, chunkText } from "zelvora-brain-public";

const index = new Bm25Index();
index.add(chunkText({ id: "guide", text: "Local retrieval example" }));

const results = index.search("retrieval", { limit: 10 });
```

## Metadata filtering

```ts
const results = await retriever.search("delivery policy", {
  filter: (chunk) => chunk.metadata?.category === "support",
});
```

Filters are applied before results are returned from both retrieval channels. This is a convenience feature, not a tenant-isolation or authorization system.

## Citations

```ts
import { buildCitations, formatCitations } from "zelvora-brain-public";

const citations = buildCitations(results, [results[0].chunk.id]);
console.log(formatCitations(citations, "markdown"));
```

Citation helpers reject chunk IDs that were not present in the supplied retrieval results.

## Evaluation

```ts
import { evaluateRetrieval } from "zelvora-brain-public";

const metrics = evaluateRetrieval({
  retrievedIds: ["doc-a", "doc-b", "doc-c"],
  relevantIds: ["doc-b"],
}, 3);
```

Only synthetic fixtures belong in this repository. Do not add customer queries, documents, or private evaluation data.

## Explicit boundary

This project intentionally excludes:

- Hosted Zelvora endpoints or API clients
- Authentication, permissions, tenant isolation, or rate limiting
- Production databases, caches, queues, or workers
- Proprietary reranking, prompts, answer generation, or answer verification
- Memory, learning, promotion, billing, auditing, or customer operations
- Bedrock, MongoDB Atlas, or private file-resolver implementations

The project is suitable for experimentation, examples, and small local workloads. Production systems still need durable storage, authorization, isolation, monitoring, capacity limits, and provider-specific operational controls.

## Development

```sh
npm run build
npm run check
npm pack --dry-run
```

The acceptance script uses only synthetic fixtures and is kept separate from application source.

## License

MIT
