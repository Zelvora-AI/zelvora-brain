import { MongoClient, type Db } from "mongodb";

export type MongoConnection = {
  client: MongoClient;
  database: Db;
};

export async function connectDatabase(
  uri: string,
  databaseName: string,
): Promise<MongoConnection> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
  try {
    await client.connect();
    const database = client.db(databaseName);
    await database.command({ ping: 1 });
    return { client, database };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}
