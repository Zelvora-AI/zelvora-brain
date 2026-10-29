import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectDatabase } from "./database.js";
import { MongoDocumentRepository } from "./document.repository.js";
import { RetrievalService } from "./retrieval.service.js";

async function start(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const config = loadConfig();
  const connection = await connectDatabase(config.mongodbUri, config.mongodbDatabase);
  const documents = new MongoDocumentRepository(connection.database);
  await documents.ensureIndexes();
  const retrieval = new RetrievalService(documents, config);
  await retrieval.refresh();
  const app = createApp(config, { documents, retrieval });
  const server = app.listen(config.port, config.host, () => {
    console.log(`Zelvora Brain Public listening on http://${config.host}:${config.port}`);
  });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received; shutting down`);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await connection.client.close();
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

start().catch((error: unknown) => {
  console.error(JSON.stringify({
    event: "startup.failed",
    code: (error as { code?: unknown })?.code ?? "STARTUP_FAILED",
  }));
  process.exitCode = 1;
});
