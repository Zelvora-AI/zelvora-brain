import type { Collection, Db } from "mongodb";
import type { Metadata, SourceDocument } from "../types.js";

type DocumentRecord = {
  _id: string;
  text: string;
  format: "text" | "markdown";
  title?: string;
  metadata?: Metadata;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredDocument = Omit<SourceDocument, "format"> & {
  format: "text" | "markdown";
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentSummary = Omit<StoredDocument, "text"> & {
  textLength: number;
};

export class MongoDocumentRepository {
  private readonly collection: Collection<DocumentRecord>;

  constructor(private readonly database: Db) {
    this.collection = database.collection<DocumentRecord>("documents");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ updatedAt: -1 }, { name: "documents_updated_at" });
  }

  async upsert(document: SourceDocument): Promise<{ document: StoredDocument; created: boolean }> {
    const existing = await this.collection.findOne({ _id: document.id });
    const now = new Date();
    const record: DocumentRecord = {
      _id: document.id,
      text: document.text,
      format: document.format ?? "text",
      ...(document.title ? { title: document.title } : {}),
      ...(document.metadata ? { metadata: { ...document.metadata } } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.collection.replaceOne({ _id: document.id }, record, { upsert: true });
    return { document: fromRecord(record), created: !existing };
  }

  async findById(documentId: string): Promise<StoredDocument | undefined> {
    const record = await this.collection.findOne({ _id: documentId });
    return record ? fromRecord(record) : undefined;
  }

  async list(limit: number, after?: string): Promise<DocumentSummary[]> {
    const filter = after ? { _id: { $gt: after } } : {};
    const records = await this.collection.find(filter).sort({ _id: 1 }).limit(limit).toArray();
    return records.map((record) => {
      const document = fromRecord(record);
      const { text, ...summary } = document;
      return { ...summary, textLength: text.length };
    });
  }

  async listAll(): Promise<StoredDocument[]> {
    const records = await this.collection.find({}).sort({ _id: 1 }).toArray();
    return records.map(fromRecord);
  }

  async delete(documentId: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: documentId });
    return result.deletedCount === 1;
  }

  async ping(): Promise<void> {
    await this.database.command({ ping: 1 });
  }
}

function fromRecord(record: DocumentRecord): StoredDocument {
  return {
    id: record._id,
    text: record.text,
    format: record.format,
    ...(record.title ? { title: record.title } : {}),
    ...(record.metadata ? { metadata: { ...record.metadata } } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
