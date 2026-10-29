import assert from "node:assert/strict";
import { createApp } from "../dist/server/app.js";
import { connectDatabase, disconnectDatabase } from "../dist/server/database.js";
import { ChunkRetrievalService } from "../dist/retrieval/chunk-retrieval.service.js";
import { BrainChunkRepository } from "../dist/storage/brain-chunk.repository.js";

const mongodbUri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
const databaseName = process.env.MONGODB_ACCEPTANCE_DATABASE;
if (!databaseName?.endsWith("_acceptance")) {
  throw new Error("MONGODB_ACCEPTANCE_DATABASE ending in _acceptance is required");
}

const connection = await connectDatabase(mongodbUri, databaseName);
let server;
try {
  await connection.dropDatabase();
  const chunks = new BrainChunkRepository();
  await chunks.ensureIndexes();
  const retrieval = new ChunkRetrievalService(chunks, 1_000);
  const apiKey = "acceptance-api-key-value";
  const app = createApp(
    { apiKey, environment: "test", jsonBodyLimit: "1mb" },
    { chunks, retrieval },
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${baseUrl}/api/v1/chunks/org-chunk`);
  assert.equal(unauthorized.status, 401);

  const created = await request(baseUrl, apiKey, "/api/v1/chunks", {
    method: "PUT",
    body: JSON.stringify({
      chunks: [
        chunk({
          chunkId: "org-chunk",
          sourceId: "returns-policy",
          scope: { type: "organization", organizationId: "org-1" },
          text: "Customers may return unopened products within 30 days of delivery.",
          embedding: [1, 0, 0],
        }),
        chunk({
          chunkId: "employee-chunk",
          sourceId: "employee-guide",
          scope: { type: "employee", organizationId: "org-1", employeeIds: ["employee-1"] },
          text: "Employee one has a private reimbursement guide.",
          embedding: [0, 1, 0],
        }),
      ],
    }),
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.data.stored, 2);

  const collections = await connection.db.listCollections({}, { nameOnly: true }).toArray();
  assert.ok(collections.some((collection) => collection.name === "brain_chunks"));
  assert.ok(!collections.some((collection) => collection.name === "documents"));
  const storedChunk = await connection.db.collection("brain_chunks").findOne({ chunkId: "org-chunk" });
  assert.equal(storedChunk.organizationId, "org-1");
  assert.equal(storedChunk.embeddingStatus, "ready");
  assert.deepEqual(storedChunk.scope, { type: "organization", organizationId: "org-1" });
  const indexes = await connection.db.collection("brain_chunks").listIndexes().toArray();
  assert.ok(indexes.some((index) => index.unique && sameKey(index.key, { organizationId: 1, chunkId: 1 })));
  assert.ok(indexes.some((index) => index.unique && sameKey(index.key, {
    organizationId: 1,
    sourceId: 1,
    position: 1,
  })));
  assert.ok(indexes.some((index) => sameKey(index.key, { organizationId: 1, embeddingStatus: 1 })));

  const found = await request(
    baseUrl,
    apiKey,
    "/api/v1/chunks/org-chunk?organizationId=org-1",
  );
  assert.equal(found.status, 200);
  assert.equal(found.body.data.chunk.sourceId, "returns-policy");

  const retrieved = await request(baseUrl, apiKey, "/api/v1/chunks/retrieve", {
    method: "POST",
    body: JSON.stringify({
      context: { organizationId: "org-1" },
      query: "return unopened product",
      queryVector: [1, 0, 0],
      limitPerChannel: 10,
      vectorMode: "exact",
    }),
  });
  assert.equal(retrieved.status, 200);
  assert.equal(retrieved.body.data.semantic[0].chunkId, "org-chunk");
  assert.equal(retrieved.body.data.lexical[0].chunkId, "org-chunk");
  assert.ok(!retrieved.body.data.semantic.some((candidate) => candidate.chunkId === "employee-chunk"));

  const employeeRetrieved = await request(baseUrl, apiKey, "/api/v1/chunks/retrieve", {
    method: "POST",
    body: JSON.stringify({
      context: { organizationId: "org-1", employeeId: "employee-1" },
      query: "private reimbursement guide",
      queryVector: [0, 1, 0],
      limitPerChannel: 10,
    }),
  });
  assert.equal(employeeRetrieved.body.data.semantic[0].chunkId, "employee-chunk");

  const deleted = await request(baseUrl, apiKey, "/api/v1/chunks/delete-source", {
    method: "POST",
    body: JSON.stringify({ organizationId: "org-1", sourceId: "returns-policy" }),
  });
  assert.equal(deleted.body.data.deleted, 1);

  console.log("Server acceptance passed: exact brain_chunks schema, scope isolation, and retrieval API");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await connection.dropDatabase();
  await disconnectDatabase();
}

function chunk({ chunkId, sourceId, scope, text, embedding }) {
  return {
    chunkId,
    sourceId,
    originType: "source",
    organizationId: "org-1",
    scope,
    text,
    position: 0,
    metadata: { fixture: true },
    knowledgeVersion: 1,
    embeddingStatus: "ready",
    embedding,
    embeddingProvider: "acceptance",
    embeddingModel: "fixture-v1",
    embeddingDimensions: embedding.length,
    embeddedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

async function request(baseUrl, apiKey, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  return { status: response.status, body: await response.json() };
}

function sameKey(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
