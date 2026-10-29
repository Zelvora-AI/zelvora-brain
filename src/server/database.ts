import mongoose, { type Connection } from "mongoose";

export async function connectDatabase(
  uri: string,
  databaseName: string,
): Promise<Connection> {
  await mongoose.connect(uri, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 5_000,
  });
  const database = mongoose.connection.db;
  if (!database) throw new Error("MongoDB connection did not provide a database");
  await database.command({ ping: 1 });
  return mongoose.connection;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
