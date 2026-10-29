import mongoose, { type Model, Schema } from "mongoose";
import {
  EMBEDDING_STATUSES,
  KNOWLEDGE_ORIGINS,
  type BrainChunk,
} from "../domain/brain-chunk.js";
import { isValidStoredScope, scopeSchema } from "../domain/scope.js";

const chunkSchema = new Schema<BrainChunk>(
  {
    chunkId: { type: String, required: true },
    sourceId: { type: String, required: true },
    originType: { type: String, enum: KNOWLEDGE_ORIGINS, default: "source" },
    memoryId: { type: String },
    memoryVersion: { type: Number, min: 1 },
    organizationId: { type: String, required: true },
    scope: { type: scopeSchema, required: true },
    text: { type: String, required: true },
    position: { type: Number, required: true, min: 0 },
    page: { type: Number, min: 1 },
    section: { type: String },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
    knowledgeVersion: { type: Number, required: true, min: 1, default: 1 },
    embeddingStatus: { type: String, enum: EMBEDDING_STATUSES, default: "pending" },
    embedding: { type: [Number], default: undefined },
    embeddingProvider: { type: String },
    embeddingModel: { type: String },
    embeddingDimensions: { type: Number, min: 1 },
    embeddingError: { type: String },
    embeddedAt: { type: Date },
  },
  {
    collection: "brain_chunks",
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    strict: "throw",
  },
);

chunkSchema.pre("validate", function () {
  if (!isValidStoredScope(this.scope) || this.scope.organizationId !== this.organizationId) {
    this.invalidate("scope", "scope must be valid and match organizationId");
  }
  if (this.originType === "memory" && (!this.memoryId || !this.memoryVersion)) {
    this.invalidate("memoryId", "Memory chunks require memoryId and memoryVersion");
  }
  if (this.originType === "source" && (this.memoryId || this.memoryVersion)) {
    this.invalidate("memoryId", "Source chunks cannot contain memory provenance");
  }
});

chunkSchema.index({ organizationId: 1, chunkId: 1 }, { unique: true });
chunkSchema.index({ organizationId: 1, sourceId: 1, position: 1 }, { unique: true });
chunkSchema.index({ organizationId: 1, memoryId: 1 });
chunkSchema.index({ organizationId: 1, "scope.type": 1 });
chunkSchema.index({ organizationId: 1, "scope.employeeIds": 1 });
chunkSchema.index({ organizationId: 1, "scope.conversationId": 1 });
chunkSchema.index({ organizationId: 1, embeddingStatus: 1 });

export const BrainChunkModel: Model<BrainChunk> =
  (mongoose.models.BrainChunk as Model<BrainChunk> | undefined) ??
  mongoose.model<BrainChunk>("BrainChunk", chunkSchema);
