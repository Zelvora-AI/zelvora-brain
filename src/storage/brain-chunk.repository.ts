import type { BrainChunk } from "../domain/brain-chunk.js";
import { buildScopeFilter, type RetrievalContext } from "../domain/scope.js";
import { BrainChunkModel } from "./brain-chunk.model.js";

export class BrainChunkRepository {
  async ensureIndexes(): Promise<void> {
    await BrainChunkModel.init();
  }

  async upsert(chunks: BrainChunk[]): Promise<number> {
    if (chunks.length === 0) return 0;
    await Promise.all(chunks.map((chunk) => new BrainChunkModel(chunk).validate()));
    await BrainChunkModel.bulkWrite(
      chunks.map((chunk) => ({
        replaceOne: {
          filter: { organizationId: chunk.organizationId, chunkId: chunk.chunkId },
          replacement: chunk,
          upsert: true,
          timestamps: false,
        },
      })),
      { ordered: true },
    );
    return chunks.length;
  }

  async findVisible(context: RetrievalContext, limit: number): Promise<BrainChunk[]> {
    return BrainChunkModel.find({
      ...buildScopeFilter(context),
      embeddingStatus: "ready",
    })
      .sort({ chunkId: 1 })
      .limit(limit)
      .select({ _id: 0 })
      .lean<BrainChunk[]>()
      .exec();
  }

  async findById(context: RetrievalContext, chunkId: string): Promise<BrainChunk | undefined> {
    const chunk = await BrainChunkModel.findOne({ chunkId, ...buildScopeFilter(context) })
      .select({ _id: 0 })
      .lean<BrainChunk>()
      .exec();
    return chunk ?? undefined;
  }

  async deleteBySource(organizationId: string, sourceId: string): Promise<number> {
    const result = await BrainChunkModel.deleteMany({ organizationId, sourceId }).exec();
    return result.deletedCount;
  }

  async count(): Promise<number> {
    return BrainChunkModel.estimatedDocumentCount().exec();
  }

  async ping(): Promise<void> {
    const database = BrainChunkModel.db.db;
    if (!database) throw new Error("MongoDB is not connected");
    await database.command({ ping: 1 });
  }
}
