import { PolygonDocument, type DocumentMergeResult } from "../crdt/document.js";
import { VertexStore } from "../crdt/vertex-store.js";
import type { PolygonOp } from "../crdt/ops.js";
import { OpLogStore } from "./op-log.js";

/**
 * Replays a document's persisted op log batch-by-batch (see `OpLogStore`'s
 * docstring for why batching matters), reconstructing both the live ring
 * state and its incremental valid-checkpoint history.
 */
export class DocumentStore {
  constructor(private readonly log: OpLogStore) {}

  create(id: string, initialOps: PolygonOp[]): DocumentMergeResult {
    this.log.createDocument(id);
    this.log.appendOps(id, initialOps);
    return this.load(id).materialize();
  }

  exists(id: string): boolean {
    return this.log.documentExists(id);
  }

  list(): string[] {
    return this.log.listDocuments();
  }

  load(id: string): PolygonDocument {
    if (!this.exists(id)) {
      throw new Error(`DocumentStore: unknown document ${id}`);
    }
    const document = new PolygonDocument(new VertexStore());
    for (const batch of this.log.getBatches(id)) {
      document.applyAll(batch.map((stored) => stored.op));
      document.materialize();
    }
    return document;
  }

  /** Pushes a batch of ops and returns the resulting materialized state plus the assigned seq range. */
  push(id: string, ops: PolygonOp[]): { result: DocumentMergeResult; seqs: number[] } {
    const document = this.load(id);
    document.applyAll(ops);
    const result = document.materialize();
    const seqs = this.log.appendOps(id, ops);
    return { result, seqs };
  }

  materialize(id: string): DocumentMergeResult {
    return this.load(id).materialize();
  }

  latestSeq(id: string): number {
    return this.log.latestSeq(id);
  }

  opsSince(id: string, sinceSeq: number) {
    if (!this.exists(id)) {
      throw new Error(`DocumentStore: unknown document ${id}`);
    }
    return this.log.getOpsSince(id, sinceSeq);
  }
}
