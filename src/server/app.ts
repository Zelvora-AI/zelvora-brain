import { randomUUID, timingSafeEqual } from "node:crypto";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import helmet from "helmet";
import type { Metadata, MetadataValue, SourceDocument } from "../types.js";
import type { ServerConfig } from "./config.js";
import type { MongoDocumentRepository } from "./document.repository.js";
import type { RetrievalService } from "./retrieval.service.js";

export type AppDependencies = {
  documents: MongoDocumentRepository;
  retrieval: RetrievalService;
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
      await dependencies.documents.ping();
      response.json({
        success: true,
        data: { status: "ready", retrieval: dependencies.retrieval.stats() },
      });
    } catch {
      response.status(503).json({
        success: false,
        error: { code: "NOT_READY", message: "MongoDB is not ready" },
      });
    }
  });

  app.use("/api/v1", apiKeyGuard(config.apiKey));

  app.post("/api/v1/documents", async (request, response) => {
    const input = parseDocument(request.body);
    const stored = await dependencies.documents.upsert(input);
    const index = await dependencies.retrieval.refresh();
    response.status(stored.created ? 201 : 200).json({
      success: true,
      data: { document: stored.document, index },
    });
  });

  app.get("/api/v1/documents", async (request, response) => {
    const limit = integer(request.query.limit, 20, "limit", 1, 100);
    const after = optionalDocumentId(request.query.after);
    const documents = await dependencies.documents.list(limit, after);
    response.json({
      success: true,
      data: {
        documents,
        nextCursor: documents.length === limit ? documents.at(-1)?.id : undefined,
      },
    });
  });

  app.get("/api/v1/documents/:documentId", async (request, response) => {
    const documentId = documentIdValue(request.params.documentId);
    const document = await dependencies.documents.findById(documentId);
    if (!document) throw apiError(404, "DOCUMENT_NOT_FOUND", "Document not found");
    response.json({ success: true, data: { document } });
  });

  app.delete("/api/v1/documents/:documentId", async (request, response) => {
    const documentId = documentIdValue(request.params.documentId);
    const deleted = await dependencies.documents.delete(documentId);
    if (!deleted) throw apiError(404, "DOCUMENT_NOT_FOUND", "Document not found");
    const index = await dependencies.retrieval.refresh();
    response.json({ success: true, data: { documentId, deleted: true, index } });
  });

  app.post("/api/v1/search", async (request, response) => {
    const body = objectBody(request.body);
    const query = requiredString(body.query, "query", 2_000);
    const limit = integer(body.limit, 10, "limit", 1, 100);
    const metadata = metadataValue(body.metadata, "metadata");
    const result = await dependencies.retrieval.search({
      query,
      limit,
      ...(metadata ? { metadata } : {}),
    });
    response.json({
      success: true,
      data: { query, ...result, index: dependencies.retrieval.stats() },
    });
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

function parseDocument(value: unknown): SourceDocument {
  const body = objectBody(value);
  const id = documentIdValue(body.id);
  const text = requiredString(body.text, "text", 750_000);
  const title = optionalString(body.title, "title", 200);
  const format = body.format ?? "text";
  if (format !== "text" && format !== "markdown") {
    throw apiError(400, "INVALID_REQUEST", "format must be text or markdown");
  }
  const metadata = metadataValue(body.metadata, "metadata");
  return {
    id,
    text,
    format,
    ...(title ? { title } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw apiError(400, "INVALID_REQUEST", "JSON object body is required");
  }
  return value as Record<string, unknown>;
}

function documentIdValue(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw apiError(
      400,
      "INVALID_REQUEST",
      "Document ID must be 1-128 letters, numbers, dots, underscores, colons, or hyphens",
    );
  }
  return value;
}

function optionalDocumentId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return documentIdValue(value);
}

function requiredString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw apiError(400, "INVALID_REQUEST", `${name} must be a non-empty string up to ${maximum} characters`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name, maximum);
}

function integer(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw apiError(400, "INVALID_REQUEST", `${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function metadataValue(value: unknown, name: string): Metadata | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw apiError(400, "INVALID_REQUEST", `${name} must be an object`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) throw apiError(400, "INVALID_REQUEST", `${name} may contain at most 50 fields`);
  const metadata: Metadata = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 100 || key.startsWith("$") || key.includes(".")) {
      throw apiError(400, "INVALID_REQUEST", `${name} contains an invalid field name`);
    }
    if (!isMetadataValue(item)) {
      throw apiError(400, "INVALID_REQUEST", `${name}.${key} must be a primitive JSON value`);
    }
    if (typeof item === "string" && item.length > 1_000) {
      throw apiError(400, "INVALID_REQUEST", `${name}.${key} is too long`);
    }
    metadata[key] = item;
  }
  return metadata;
}

function isMetadataValue(value: unknown): value is MetadataValue {
  return value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

type ApiError = Error & { status: number; code: string };

function apiError(status: number, code: string, message: string): ApiError {
  return Object.assign(new Error(message), { status, code });
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const requestId = response.locals.requestId as string;
  const syntaxError = error instanceof SyntaxError && "body" in error;
  const status = syntaxError ? 400 : Number((error as Partial<ApiError>).status ?? 500);
  const code = syntaxError
    ? "INVALID_JSON"
    : typeof (error as Partial<ApiError>).code === "string"
      ? (error as Partial<ApiError>).code!
      : "INTERNAL_ERROR";
  const message = status >= 500
    ? "Internal server error"
    : error instanceof Error ? error.message : "Request failed";
  if (status >= 500) {
    console.error(JSON.stringify({ event: "request.failed", requestId, code }));
  }
  response.status(status).json({ success: false, error: { code, message, requestId } });
};
