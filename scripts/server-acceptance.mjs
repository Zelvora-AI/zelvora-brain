import assert from "node:assert/strict";
import { createApp } from "../dist/server/app.js";
import { connectDatabase } from "../dist/server/database.js";
import { MongoDocumentRepository } from "../dist/server/document.repository.js";
import { RetrievalService } from "../dist/server/retrieval.service.js";

const mongodbUri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
const databaseName = process.env.MONGODB_ACCEPTANCE_DATABASE;
if (!databaseName?.endsWith("_acceptance")) {
  throw new Error("MONGODB_ACCEPTANCE_DATABASE ending in _acceptance is required");
}

const connection = await connectDatabase(mongodbUri, databaseName);
let server;
try {
  await connection.database.dropDatabase();
  const documents = new MongoDocumentRepository(connection.database);
  await documents.ensureIndexes();
  const retrieval = new RetrievalService(documents, {
    chunkSize: 300,
    chunkOverlap: 40,
    embeddingDimensions: 64,
  });
  await retrieval.refresh();
  const apiKey = "acceptance-api-key-value";
  const app = createApp(
    { apiKey, environment: "test", jsonBodyLimit: "1mb" },
    { documents, retrieval },
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${baseUrl}/api/v1/documents`);
  assert.equal(unauthorized.status, 401);

  const created = await request(baseUrl, apiKey, "/api/v1/documents", {
    method: "POST",
    body: JSON.stringify({
      id: "returns-policy",
      title: "Returns Policy",
      format: "markdown",
      metadata: { category: "support" },
      text: "# Returns\nCustomers may return unopened products within 30 days of delivery.",
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.index.documents, 1);

  const found = await request(baseUrl, apiKey, "/api/v1/documents/returns-policy");
  assert.equal(found.status, 200);
  assert.equal(found.body.data.document.title, "Returns Policy");

  const listed = await request(baseUrl, apiKey, "/api/v1/documents?limit=10");
  assert.equal(listed.body.data.documents.length, 1);
  assert.equal(listed.body.data.documents[0].text, undefined);

  const searched = await request(baseUrl, apiKey, "/api/v1/search", {
    method: "POST",
    body: JSON.stringify({ query: "return unopened product", limit: 3 }),
  });
  assert.equal(searched.status, 200);
  assert.equal(searched.body.data.results[0].chunk.documentId, "returns-policy");
  assert.equal(searched.body.data.citations[0].documentId, "returns-policy");

  const deleted = await request(baseUrl, apiKey, "/api/v1/documents/returns-policy", {
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.index.documents, 0);

  const missing = await request(baseUrl, apiKey, "/api/v1/documents/returns-policy");
  assert.equal(missing.status, 404);

  console.log("Server acceptance passed: auth, MongoDB persistence, CRUD, and hybrid search");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await connection.database.dropDatabase();
  await connection.client.close();
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
