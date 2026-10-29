import { randomUUID, timingSafeEqual } from "node:crypto";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import helmet from "helmet";
import {
  EMBEDDING_STATUSES,
  KNOWLEDGE_ORIGINS,
  type BrainChunk,
  type EmbeddingStatus,
  type KnowledgeOrigin,
} from "../domain/brain-chunk.js";
import type { KnowledgeScope, RetrievalContext } from "../domain/scope.js";
import type { ChunkRetrievalService } from "../retrieval/chunk-retrieval.service.js";
import type { ServerConfig } from "./config.js";
import type { BrainChunkRepository } from "../storage/brain-chunk.repository.js";

export type AppDependencies = {
  chunks: BrainChunkRepository;
  retrieval: ChunkRetrievalService;
};

export function createApp(
  config: Pick<ServerConfig, "apiKey" | "environment" | "jsonBodyLimit">,
  dependencies: AppDependencies,
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use((request, response, next) => {
    response.locals.requestId = request.header("x-request-id")?.slice(0, 128) || randomUUID();
    response.setHeader("x-request-id", response.locals.requestId);
    next();
  });
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.get("/health", (_request, response) => {
    response.json({ success: true, data: { status: "ok" } });
  });

  app.get("/ready", async (_request, response) => {
    try {
      await dependencies.chunks.ping();
      response.json({
        success: true,
        data: { status: "ready", collection: "brain_chunks", chunks: await dependencies.chunks.count() },
      });
    } catch {
      response.status(503).json({
        success: false,
        error: { code: "NOT_READY", message: "MongoDB is not ready" },
      });
    }
  });

  app.use("/api/v1", apiKeyGuard(config.apiKey));

  app.put("/api/v1/chunks", async (request, response) => {
    const body = objectBody(request.body);
    if (!Array.isArray(body.chunks) || body.chunks.length < 1 || body.chunks.length > 500) {
      throw apiError(400, "INVALID_REQUEST", "chunks must contain 1 to 500 items");
    }
    const chunks = body.chunks.map(parseBrainChunk);
    const stored = await dependencies.chunks.upsert(chunks);
    response.json({ success: true, data: { stored, collection: "brain_chunks" } });
  });

  app.post("/api/v1/chunks/retrieve", async (request, response) => {
    const body = objectBody(request.body);
    const context = parseRetrievalContext(body.context);
    const query = requiredString(body.query, "query", 2_000);
    const queryVector = optionalVector(body.queryVector, "queryVector");
    const limitPerChannel = optionalInteger(body.limitPerChannel, "limitPerChannel", 1, 50);
    const vectorMode = body.vectorMode;
    if (vectorMode !== undefined && vectorMode !== "approximate" && vectorMode !== "exact") {
      throw apiError(400, "INVALID_REQUEST", "vectorMode must be approximate or exact");
    }
    const candidates = await dependencies.retrieval.retrieve({
      context,
      query,
      ...(queryVector ? { queryVector } : {}),
      ...(limitPerChannel === undefined ? {} : { limitPerChannel }),
      ...(vectorMode === undefined ? {} : { vectorMode }),
    });
    response.json({ success: true, data: candidates });
  });

  app.get("/api/v1/chunks/:chunkId", async (request, response) => {
    const context = parseRetrievalContext({
      organizationId: request.query.organizationId,
      employeeId: request.query.employeeId,
      conversationId: request.query.conversationId,
    });
    const chunkId = identifier(request.params.chunkId, "chunkId");
    const chunk = await dependencies.chunks.findById(context, chunkId);
    if (!chunk) throw apiError(404, "CHUNK_NOT_FOUND", "Chunk not found");
    response.json({ success: true, data: { chunk } });
  });

  app.post("/api/v1/chunks/delete-source", async (request, response) => {
    const body = objectBody(request.body);
    const organizationId = identifier(body.organizationId, "organizationId");
    const sourceId = identifier(body.sourceId, "sourceId");
    const deleted = await dependencies.chunks.deleteBySource(organizationId, sourceId);
    response.json({ success: true, data: { organizationId, sourceId, deleted } });
  });

  app.use((_request, _response, next) => {
    next(apiError(404, "NOT_FOUND", "Route not found"));
  });
  app.use(errorHandler);
  return app;
}

function apiKeyGuard(expected: string | undefined): RequestHandler {
  if (!expected) return (_request, _response, next) => next();
  return (request, _response, next) => {
    const header = request.header("authorization");
    const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (!constantTimeEqual(provided, expected)) {
      return next(apiError(401, "UNAUTHORIZED", "A valid bearer API key is required"));
    }
    next();
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBrainChunk(value: unknown): BrainChunk {
  const body = objectBody(value);
  const organizationId = identifier(body.organizationId, "organizationId");
  const originType = enumValue(body.originType ?? "source", KNOWLEDGE_ORIGINS, "originType");
  const embeddingStatus = enumValue(
    body.embeddingStatus ?? "pending",
    EMBEDDING_STATUSES,
    "embeddingStatus",
  );
  const scope = parseScope(body.scope, organizationId);
  const embedding = optionalVector(body.embedding, "embedding");
  const embeddedAt = optionalDate(body.embeddedAt, "embeddedAt");
  const createdAt = optionalDate(body.createdAt, "createdAt") ?? new Date();
  const metadata = metadataValue(body.metadata);
  const chunk: BrainChunk = {
    chunkId: identifier(body.chunkId, "chunkId"),
    sourceId: identifier(body.sourceId, "sourceId"),
    originType: originType as KnowledgeOrigin,
    ...(body.memoryId === undefined ? {} : { memoryId: identifier(body.memoryId, "memoryId") }),
    ...(body.memoryVersion === undefined
      ? {}
      : { memoryVersion: integer(body.memoryVersion, "memoryVersion", 1, Number.MAX_SAFE_INTEGER) }),
    organizationId,
    scope,
    text: requiredString(body.text, "text", 200_000),
    position: integer(body.position, "position", 0, Number.MAX_SAFE_INTEGER),
    ...(body.page === undefined ? {} : { page: integer(body.page, "page", 1, Number.MAX_SAFE_INTEGER) }),
    ...(body.section === undefined ? {} : { section: requiredString(body.section, "section", 1_000) }),
    metadata,
    knowledgeVersion: integer(body.knowledgeVersion ?? 1, "knowledgeVersion", 1, Number.MAX_SAFE_INTEGER),
    embeddingStatus: embeddingStatus as EmbeddingStatus,
    ...(embedding ? { embedding } : {}),
    ...(body.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: requiredString(body.embeddingProvider, "embeddingProvider", 200) }),
    ...(body.embeddingModel === undefined
      ? {}
      : { embeddingModel: requiredString(body.embeddingModel, "embeddingModel", 500) }),
    ...(body.embeddingDimensions === undefined
      ? {}
      : { embeddingDimensions: integer(body.embeddingDimensions, "embeddingDimensions", 1, 4_096) }),
    ...(body.embeddingError === undefined
      ? {}
      : { embeddingError: requiredString(body.embeddingError, "embeddingError", 2_000) }),
    ...(embeddedAt ? { embeddedAt } : {}),
    createdAt,
  };
  if (chunk.embedding && chunk.embeddingDimensions && chunk.embedding.length !== chunk.embeddingDimensions) {
    throw apiError(400, "INVALID_REQUEST", "embeddingDimensions must match embedding length");
  }
  return chunk;
}

function parseScope(value: unknown, organizationId: string): KnowledgeScope {
  const scope = objectBody(value);
  const type = scope.type;
  const scopeOrganizationId = identifier(scope.organizationId, "scope.organizationId");
  if (scopeOrganizationId !== organizationId) {
    throw apiError(400, "INVALID_REQUEST", "scope.organizationId must match organizationId");
  }
  if (type === "organization") {
    return { type, organizationId };
  }
  if (type === "employee") {
    if (!Array.isArray(scope.employeeIds) || scope.employeeIds.length < 1 || scope.employeeIds.length > 100) {
      throw apiError(400, "INVALID_REQUEST", "scope.employeeIds must contain 1 to 100 IDs");
    }
    return { type, organizationId, employeeIds: scope.employeeIds.map((id) => identifier(id, "employeeId")) };
  }
  if (type === "conversation") {
    return { type, organizationId, conversationId: identifier(scope.conversationId, "conversationId") };
  }
  throw apiError(400, "INVALID_REQUEST", "scope.type is invalid");
}

function parseRetrievalContext(value: unknown): RetrievalContext {
  const body = objectBody(value);
  return {
    organizationId: identifier(body.organizationId, "context.organizationId"),
    ...(body.employeeId === undefined
      ? {}
      : { employeeId: identifier(body.employeeId, "context.employeeId") }),
    ...(body.conversationId === undefined
      ? {}
      : { conversationId: identifier(body.conversationId, "context.conversationId") }),
  };
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw apiError(400, "INVALID_REQUEST", "JSON object is required");
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw apiError(400, "INVALID_REQUEST", `${name} is invalid`);
  }
  return value;
}

function requiredString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw apiError(400, "INVALID_REQUEST", `${name} must be a non-empty string up to ${maximum} characters`);
  }
  return value.trim();
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw apiError(400, "INVALID_REQUEST", `${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function optionalInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return value === undefined ? undefined : integer(value, name, minimum, maximum);
}

function optionalVector(value: unknown, name: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 4_096 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw apiError(400, "INVALID_REQUEST", `${name} must contain 1 to 4096 finite numbers`);
  }
  return value as number[];
}

function optionalDate(value: unknown, name: string): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw apiError(400, "INVALID_REQUEST", `${name} must be an ISO date`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw apiError(400, "INVALID_REQUEST", `${name} is invalid`);
  return date;
}

function metadataValue(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw apiError(400, "INVALID_REQUEST", "metadata must be an object");
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 50_000) throw apiError(400, "INVALID_REQUEST", "metadata is too large");
  for (const key of Object.keys(value)) {
    if (!key || key.startsWith("$") || key.includes(".")) {
      throw apiError(400, "INVALID_REQUEST", "metadata contains an invalid field name");
    }
  }
  return value as Record<string, unknown>;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw apiError(400, "INVALID_REQUEST", `${name} is invalid`);
  }
  return value as T;
}

type ApiError = Error & { status: number; code: string };

function apiError(status: number, code: string, message: string): ApiError {
  return Object.assign(new Error(message), { status, code });
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const requestId = response.locals.requestId as string;
  const syntaxError = error instanceof SyntaxError && "body" in error;
  const validationError = ["ValidationError", "StrictModeError"].includes(error?.name);
  const duplicateError = error?.code === 11_000;
  const status = syntaxError || validationError ? 400
    : duplicateError ? 409
    : Number((error as Partial<ApiError>).status ?? 500);
  const code = syntaxError ? "INVALID_JSON"
    : validationError ? "INVALID_CHUNK"
    : duplicateError ? "CHUNK_CONFLICT"
    : typeof (error as Partial<ApiError>).code === "string"
      ? (error as Partial<ApiError>).code!
      : "INTERNAL_ERROR";
  const message = status >= 500
    ? "Internal server error"
    : error instanceof Error ? error.message : "Request failed";
  if (status >= 500) console.error(JSON.stringify({ event: "request.failed", requestId, code }));
  response.status(status).json({ success: false, error: { code, message, requestId } });
};
