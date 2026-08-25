import { DatabaseSync } from "node:sqlite";
import type { PolygonOp } from "../crdt/ops.js";

export interface StoredOp {
  seq: number;
  op: PolygonOp;
}

/**
 * Append-only, per-document op log backed by SQLite. This is the actual
 * offline-sync substrate: a device pulls everything after the highest
 * `seq` it's already seen (`getOpsSince`), applies those ops locally (the
 * CRDT guarantees that's safe in any order), and pushes its own new ops
 * back (`appendOps`). `seq` is just this log's position, unrelated to an
 * op's own Lamport clock.
 *
 * Every `appendOps` call is tagged with a `batch` number. That's not just
 * bookkeeping: `PolygonDocument.materialize()` builds up a "last known
 * valid position" checkpoint incrementally, one `materialize()` call at a
 * time, and that checkpoint history is what lets it repair a *future*
 * conflict by reverting to the right fallback. Replaying the whole op log
 * in one shot after a restart and calling `materialize()` only once would
 * flatten that history — a restart would forget which state was valid
 * right before an unresolved conflict. Replaying batch-by-batch, calling
 * `materialize()` once per batch (see `DocumentStore.load`), reconstructs
 * the same incremental checkpoint history live operation would have built.
 */
export class OpLogStore {
  private readonly db: DatabaseSync;

  constructor(path: string = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ops (
        document_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        batch INTEGER NOT NULL,
        op_json TEXT NOT NULL,
        PRIMARY KEY (document_id, seq)
      );
    `);
  }

  createDocument(id: string): void {
    if (this.documentExists(id)) {
      throw new Error(`OpLogStore: document ${id} already exists`);
    }
    this.db.prepare("INSERT INTO documents (id, created_at) VALUES (?, ?)").run(id, new Date().toISOString());
  }

  documentExists(id: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM documents WHERE id = ?").get(id);
    return row !== undefined;
  }

  listDocuments(): string[] {
    const rows = this.db.prepare("SELECT id FROM documents ORDER BY created_at ASC").all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  latestSeq(documentId: string): number {
    const row = this.db
      .prepare("SELECT MAX(seq) as maxSeq FROM ops WHERE document_id = ?")
      .get(documentId) as { maxSeq: number | null };
    return row.maxSeq ?? 0;
  }

  private latestBatch(documentId: string): number {
    const row = this.db
      .prepare("SELECT MAX(batch) as maxBatch FROM ops WHERE document_id = ?")
      .get(documentId) as { maxBatch: number | null };
    return row.maxBatch ?? 0;
  }

  /** Appends `ops` as a single batch — one client push, one `materialize()` checkpoint on replay. */
  appendOps(documentId: string, ops: PolygonOp[]): number[] {
    if (!this.documentExists(documentId)) {
      throw new Error(`OpLogStore: unknown document ${documentId}`);
    }
    const insert = this.db.prepare("INSERT INTO ops (document_id, seq, batch, op_json) VALUES (?, ?, ?, ?)");
    let seq = this.latestSeq(documentId);
    const batch = this.latestBatch(documentId) + 1;
    const assigned: number[] = [];
    for (const op of ops) {
      seq += 1;
      insert.run(documentId, seq, batch, JSON.stringify(op));
      assigned.push(seq);
    }
    return assigned;
  }

  getOpsSince(documentId: string, sinceSeq: number): StoredOp[] {
    const rows = this.db
      .prepare("SELECT seq, op_json FROM ops WHERE document_id = ? AND seq > ? ORDER BY seq ASC")
      .all(documentId, sinceSeq) as { seq: number; op_json: string }[];
    return rows.map((r) => ({ seq: r.seq, op: JSON.parse(r.op_json) as PolygonOp }));
  }

  getAllOps(documentId: string): StoredOp[] {
    return this.getOpsSince(documentId, 0);
  }

  /** Ops grouped by push batch, in original order — what `DocumentStore.load` replays. */
  getBatches(documentId: string): StoredOp[][] {
    const rows = this.db
      .prepare("SELECT seq, batch, op_json FROM ops WHERE document_id = ? ORDER BY seq ASC")
      .all(documentId) as { seq: number; batch: number; op_json: string }[];

    const batches: StoredOp[][] = [];
    let currentBatch = -1;
    for (const row of rows) {
      if (row.batch !== currentBatch) {
        batches.push([]);
        currentBatch = row.batch;
      }
      batches[batches.length - 1]!.push({ seq: row.seq, op: JSON.parse(row.op_json) as PolygonOp });
    }
    return batches;
  }

  close(): void {
    this.db.close();
  }
}
