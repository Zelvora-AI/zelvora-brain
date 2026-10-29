# Zelvora Brain Public

An independent Express and MongoDB service that stores and retrieves Brain chunks. The private Brain service calls this service over HTTP; this service never calls the private repository or imports its code.

The MongoDB collection, chunk fields, scope rules, and candidate response shapes match the retrieval contracts currently used by `artifact-brain`.

## Responsibility boundary

```text
Private Brain
  ├── parses and chunks knowledge
  ├── creates embeddings
  ├── calls PUT /api/v1/chunks
  ├── embeds a search query
  └── calls POST /api/v1/chunks/retrieve
                     │
                     ▼
Public retrieval service
  ├── stores exact BrainChunk records in brain_chunks
  ├── applies organization/employee/conversation scope filters
  ├── retrieves semantic and lexical candidates
  └── returns HybridCandidateSet
                     │
                     ▼
Private Brain
  ├── verifies source and memory lifecycle state
  ├── performs RRF and proprietary reranking
  ├── builds grounded answers
  └── applies memory and learning policy
```

This repository does not contain answer generation, prompts, reranking, memory policy, learning, auditing, billing, customer workflows, or private service implementations.

## Matching MongoDB schema

The service uses the same `brain_chunks` collection and Mongoose schema fields:

```text
chunkId
sourceId
originType
memoryId
memoryVersion
organizationId
scope
text
position
page
section
metadata
knowledgeVersion
embeddingStatus
embedding
embeddingProvider
embeddingModel
embeddingDimensions
embeddingError
embeddedAt
createdAt
```

It also creates the same indexes:

- Unique `{ organizationId, chunkId }`
- Unique `{ organizationId, sourceId, position }`
- `{ organizationId, memoryId }`
- Organization and scope-type indexes
- Employee and conversation scope indexes
- `{ organizationId, embeddingStatus }`

The service validates that stored scopes match `organizationId`, memory chunks carry memory provenance, and source chunks do not.

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

Production mode requires `PUBLIC_BRAIN_API_KEY` with at least 16 characters. When configured, call `/api/v1` routes with `Authorization: Bearer <key>`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `3030` | HTTP port |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | Retrieval MongoDB connection |
| `MONGODB_DATABASE` | `zelvora_brain_public` | Retrieval database name |
| `PUBLIC_BRAIN_API_KEY` | empty | Required in production |
| `PUBLIC_BRAIN_MAX_CANDIDATE_CHUNKS` | `5000` | Maximum visible chunks scored per request |

## API

### Liveness and readiness

```sh
curl http://127.0.0.1:3030/health
curl http://127.0.0.1:3030/ready
```

Readiness verifies MongoDB and reports the `brain_chunks` count.

### Upsert exact Brain chunks

```sh
curl --request PUT http://127.0.0.1:3030/api/v1/chunks \
  --header 'Authorization: Bearer local-development-key' \
  --header 'Content-Type: application/json' \
  --data '{
    "chunks": [{
      "chunkId": "chunk-001",
      "sourceId": "source-001",
      "originType": "source",
      "organizationId": "org-001",
      "scope": { "type": "organization", "organizationId": "org-001" },
      "text": "Customers may return unopened products within 30 days.",
      "position": 0,
      "metadata": { "title": "Returns Policy" },
      "knowledgeVersion": 1,
      "embeddingStatus": "ready",
      "embedding": [0.12, 0.34, 0.56],
      "embeddingProvider": "example",
      "embeddingModel": "example-v1",
      "embeddingDimensions": 3
    }]
  }'
```

The endpoint accepts 1-500 chunks. The private Brain ingestion/indexing flow should call it after producing validated chunks and embeddings.

### Retrieve candidate chunks

```sh
curl --request POST http://127.0.0.1:3030/api/v1/chunks/retrieve \
  --header 'Authorization: Bearer local-development-key' \
  --header 'Content-Type: application/json' \
  --data '{
    "context": {
      "organizationId": "org-001",
      "employeeId": "employee-001",
      "conversationId": "conversation-001"
    },
    "query": "What is the return period?",
    "queryVector": [0.12, 0.34, 0.56],
    "limitPerChannel": 40,
    "vectorMode": "exact"
  }'
```

The response matches the private `HybridCandidateSet` contract:

```json
{
  "semantic": [{ "channel": "semantic", "rank": 1, "chunkId": "chunk-001" }],
  "lexical": [{ "channel": "lexical", "rank": 1, "chunkId": "chunk-001" }],
  "channels": { "semantic": true, "lexical": true }
}
```

Each candidate also contains `sourceId`, origin/memory provenance, text, page, section, metadata, and score.

Scope filtering happens in MongoDB before scoring:

- Organization chunks are visible within that organization.
- Employee chunks require a matching `employeeId`.
- Conversation chunks require a matching `conversationId`.

If `queryVector` is omitted, the semantic channel is disabled and lexical candidates are still returned.

### Read one permitted chunk

```sh
curl 'http://127.0.0.1:3030/api/v1/chunks/chunk-001?organizationId=org-001&employeeId=employee-001' \
  --header 'Authorization: Bearer local-development-key'
```

### Delete chunks for a source

```sh
curl --request POST http://127.0.0.1:3030/api/v1/chunks/delete-source \
  --header 'Authorization: Bearer local-development-key' \
  --header 'Content-Type: application/json' \
  --data '{ "organizationId": "org-001", "sourceId": "source-001" }'
```

## Retrieval implementation

The standalone implementation reads a bounded, scope-filtered candidate set from MongoDB, computes BM25 and exact cosine similarity in process, and returns separate ranked channels. It accepts both `approximate` and `exact` contract values, but this reference implementation currently computes exact similarity for both.

This keeps the repository runnable on ordinary MongoDB. It is not equivalent to Atlas Search at large scale. Before high-volume or multi-replica deployment, replace the scorer with native `$search` and `$vectorSearch` while retaining the same schema and API contract.

## Validation

```sh
npm run check
```

The live server acceptance check requires a disposable database whose name ends in `_acceptance`:

```sh
MONGODB_URI=mongodb://127.0.0.1:27017 \
MONGODB_ACCEPTANCE_DATABASE=zelvora_brain_public_local_acceptance \
npm run acceptance:server
```

It verifies the exact `brain_chunks` collection, matching fields and indexes, service authentication, scope isolation, indexing, retrieval, and source deletion.

## Integration status

The public retrieval service is implemented. `artifact-brain` has intentionally not been changed yet. Its current hybrid retrieval layer still calls its internal vector and lexical stores. Replacing that path with this HTTP API should be reviewed and implemented separately so the private repository change remains explicit and auditable.

## License

MIT
