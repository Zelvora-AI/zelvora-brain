# Zelvora Brain Public

An independent Express and MongoDB retrieval server for TypeScript and JavaScript. It persists source documents in its own MongoDB database and exposes APIs for document management and hybrid retrieval.

This repository does **not** call a private Zelvora API, import private Brain code, or share a database with the private service.

## Included

- Express 5 HTTP server with Helmet headers
- MongoDB document persistence
- Optional bearer API key; mandatory in production
- Plain-text and heading-aware Markdown chunking
- Local BM25 keyword retrieval
- In-memory cosine-similarity vector search
- Hybrid Reciprocal Rank Fusion
- Exact-match metadata filtering
- Citation validation and formatting
- Retrieval evaluation helpers
- Health and MongoDB readiness endpoints
- Synthetic library and live-server acceptance scripts

## Architecture

```text
HTTP request
    │
    ▼
Express routes ───────► MongoDB documents
    │                         │
    │                         ▼
    └────────────────► chunk and rebuild
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
                  BM25            vector search
                    └─────────┬─────────┘
                              ▼
                   Reciprocal Rank Fusion
                              │
                              ▼
                    results and citations
```

MongoDB is the durable source of truth. The reference server rebuilds its BM25 and vector indexes in process when it starts and after a document mutation. This is deliberately simple and works well for examples and bounded datasets; it is not a horizontally scalable search architecture.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- MongoDB 7 or newer

## Start locally

```sh
cp .env.example .env
docker compose up -d mongodb
npm install
npm run dev
```

The default address is `http://127.0.0.1:3030`.

For a production build:

```sh
npm run build
npm start
```

Production startup requires `PUBLIC_BRAIN_API_KEY` with at least 16 characters. Health and readiness routes remain unauthenticated; all `/api/v1` routes require `Authorization: Bearer <key>` when a key is configured.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `3030` | HTTP port |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | MongoDB connection |
| `MONGODB_DATABASE` | `zelvora_brain_public` | Independent database name |
| `PUBLIC_BRAIN_API_KEY` | empty | Optional outside production |
| `PUBLIC_BRAIN_CHUNK_SIZE` | `1200` | Chunk size in characters |
| `PUBLIC_BRAIN_CHUNK_OVERLAP` | `150` | Overlap in characters |
| `PUBLIC_BRAIN_HASH_EMBEDDING_DIMENSIONS` | `128` | Example vector dimensions |

## API

### Liveness

```sh
curl http://127.0.0.1:3030/health
```

### MongoDB and retrieval readiness

```sh
curl http://127.0.0.1:3030/ready
```

### Create or replace a document

```sh
curl --request POST http://127.0.0.1:3030/api/v1/documents \
  --header 'Authorization: Bearer local-development-key' \
  --header 'Content-Type: application/json' \
  --data '{
    "id": "returns-policy",
    "title": "Returns Policy",
    "format": "markdown",
    "metadata": { "category": "support" },
    "text": "# Returns\nUnopened products may be returned within 30 days."
  }'
```

Posting an existing ID replaces that document and rebuilds the local retrieval index.

### List documents

```sh
curl 'http://127.0.0.1:3030/api/v1/documents?limit=20&after=previous-id' \
  --header 'Authorization: Bearer local-development-key'
```

List responses omit document text. Use the document route when the full source is required.

### Read a document

```sh
curl http://127.0.0.1:3030/api/v1/documents/returns-policy \
  --header 'Authorization: Bearer local-development-key'
```

### Hybrid search

```sh
curl --request POST http://127.0.0.1:3030/api/v1/search \
  --header 'Authorization: Bearer local-development-key' \
  --header 'Content-Type: application/json' \
  --data '{
    "query": "When can I return an unopened product?",
    "limit": 5,
    "metadata": { "category": "support" }
  }'
```

Search returns ranked chunks, lexical/vector channel provenance, and citations.

### Delete a document

```sh
curl --request DELETE http://127.0.0.1:3030/api/v1/documents/returns-policy \
  --header 'Authorization: Bearer local-development-key'
```

## Embedding limitation

`HashEmbeddingProvider` uses deterministic feature hashing so the server works without credentials, private services, or network calls. It is not a semantic embedding model. Applications needing semantic retrieval should implement the exported `EmbeddingProvider` interface using a local model or another provider selected by the operator.

Changing the provider in a multi-replica deployment also requires a durable vector index. The bundled in-memory vector store is intentionally not presented as production infrastructure.

## Validation

Library checks require no database:

```sh
npm run check
npm run example
```

The server acceptance check requires a dedicated disposable database. Its name must end in `_acceptance`:

```sh
MONGODB_URI=mongodb://127.0.0.1:27017 \
MONGODB_ACCEPTANCE_DATABASE=zelvora_brain_public_local_acceptance \
npm run acceptance:server
```

The acceptance script verifies bearer authentication, MongoDB persistence, create/read/list/delete operations, and hybrid search. It deletes only the explicitly named acceptance database.

## Explicit private boundary

This repository intentionally excludes:

- Private Zelvora endpoints or client SDKs
- Private schemas, repositories, prompts, or tuning values
- Tenant isolation and organization permissions
- Proprietary reranking and answer verification
- Memory, learning, promotion, billing, or auditing
- Bedrock, Atlas Search, private file resolvers, queues, or workers
- Customer documents, queries, and evaluation datasets

Do not expose the reference server directly to the internet without additional rate limiting, access policy, TLS termination, monitoring, backups, and capacity controls.

## License

MIT
