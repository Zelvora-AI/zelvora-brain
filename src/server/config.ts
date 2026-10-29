export type ServerConfig = {
  environment: "development" | "test" | "production";
  host: string;
  port: number;
  mongodbUri: string;
  mongodbDatabase: string;
  apiKey?: string;
  jsonBodyLimit: string;
  chunkSize: number;
  chunkOverlap: number;
  embeddingDimensions: number;
};

export function loadConfig(): ServerConfig {
  const environment = environmentValue(process.env.NODE_ENV);
  const port = integerValue(process.env.PORT, 3_030, "PORT", 1, 65_535);
  const mongodbDatabase = process.env.MONGODB_DATABASE?.trim() || "zelvora_brain_public";
  const apiKey = process.env.PUBLIC_BRAIN_API_KEY?.trim() || undefined;
  const chunkSize = integerValue(
    process.env.PUBLIC_BRAIN_CHUNK_SIZE,
    1_200,
    "PUBLIC_BRAIN_CHUNK_SIZE",
    100,
    100_000,
  );
  const chunkOverlap = integerValue(
    process.env.PUBLIC_BRAIN_CHUNK_OVERLAP,
    150,
    "PUBLIC_BRAIN_CHUNK_OVERLAP",
    0,
    chunkSize - 1,
  );

  if (!/^[A-Za-z0-9_-]+$/.test(mongodbDatabase)) {
    throw new Error("MONGODB_DATABASE may contain only letters, numbers, underscores, and hyphens");
  }
  if (environment === "production" && (!apiKey || apiKey.length < 16)) {
    throw new Error("PUBLIC_BRAIN_API_KEY with at least 16 characters is required in production");
  }

  return {
    environment,
    host: process.env.HOST?.trim() || "127.0.0.1",
    port,
    mongodbUri: process.env.MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017",
    mongodbDatabase,
    ...(apiKey ? { apiKey } : {}),
    jsonBodyLimit: "1mb",
    chunkSize,
    chunkOverlap,
    embeddingDimensions: integerValue(
      process.env.PUBLIC_BRAIN_HASH_EMBEDDING_DIMENSIONS,
      128,
      "PUBLIC_BRAIN_HASH_EMBEDDING_DIMENSIONS",
      8,
      4_096,
    ),
  };
}

function environmentValue(value: string | undefined): ServerConfig["environment"] {
  const environment = value?.trim() || "development";
  if (!["development", "test", "production"].includes(environment)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  return environment as ServerConfig["environment"];
}

function integerValue(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}
