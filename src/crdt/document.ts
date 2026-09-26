import { compareId, idToString, type OpId } from "./ids.js";
import { RgaList } from "./rga.js";
import { VertexStore } from "./vertex-store.js";
import type { DeleteVertexOp, PolygonOp } from "./ops.js";
import type { Point, Ring } from "../types.js";
import { findSelfIntersections } from "../topology.js";

export interface DocumentMergeResult {
  polygon: Ring;
  /**
   * Vertex ids (as strings) where the returned polygon differs from the raw
   * CRDT state, because a move or delete on that vertex was held back to keep
   * the polygon valid.
   */
  conflicts: string[];
  valid: boolean;
}

type Edit = { kind: "move"; id: OpId; index: number; position: Point } | { kind: "delete"; id: OpId; index: number };

function pointsEqual(p: Point, q: Point): boolean {
  return p[0] === q[0] && p[1] === q[1];
}

/**
 * One polygon's ring order (an RGA of vertex ids) plus a reference to the
 * `VertexStore` holding those vertices' positions. Ops are assumed to be
 * applied at most once and only after any op they depend on (an insert
 * before a move that targets it, an insert before another insert anchored
 * on it) — this MVP doesn't do its own causal buffering.
 *
 * `materialize()` is the topology guarantee, and it is a pure function of
 * the set of ops applied: two replicas holding the same ops return the same
 * result, no matter what order the ops arrived in or how often either
 * replica materialized along the way. It starts from every vertex at its
 * creation position, then replays every move and delete in one canonical
 * order (`compareId`: Lamport clock, then actor), accepting each edit only
 * if it doesn't add a self-intersection. A rejected edit is held back and
 * its vertex is listed in `conflicts`. When two concurrent edits collide,
 * the one earlier in that order is kept and the later one is flagged. The
 * choice is arbitrary but identical on every replica.
 *
 * Deletes are held to the same rule, and also rejected if they would drop
 * the ring below 3 vertices. Inserts are never rejected: a brand-new vertex
 * has no earlier position to fall back to, so if new vertices alone create
 * a crossing, `materialize()` reports `valid: false` rather than guessing.
 *
 * Shared vertices (see `VertexStore`) are validated per document: a move
 * that keeps parcel P valid but would break neighbouring parcel Q is
 * accepted by P and flagged by Q, so the disagreement is reported instead
 * of silently hidden.
 */
export class PolygonDocument {
  private deletes = new Map<string, DeleteVertexOp>();

  constructor(
    private readonly store: VertexStore,
    private readonly ring: RgaList<OpId> = new RgaList<OpId>(),
  ) {}

  apply(op: PolygonOp): void {
    switch (op.type) {
      case "insert":
        this.store.create(op.id, op.position);
        this.ring.insertAfter(op.id, op.after, op.id);
        break;
      case "move":
        this.store.move(op.vertex, op.position, op.id);
        break;
      case "delete":
        this.ring.remove(op.vertex);
        this.deletes.set(idToString(op.id), op);
        break;
    }
  }

  /**
   * Places an existing vertex (already created in this document's
   * `VertexStore`, typically by another `PolygonDocument` sharing that
   * store) into *this* ring, without creating a new store entry. This is
   * how a neighboring feature references a shared boundary vertex it
   * didn't itself insert.
   */
  reference(vertex: OpId, after: OpId | null): void {
    if (!this.store.get(vertex)) {
      throw new Error(`PolygonDocument.reference: ${idToString(vertex)} doesn't exist in this document's store`);
    }
    this.ring.insertAfter(vertex, after, vertex);
  }

  applyAll(ops: PolygonOp[]): void {
    for (const op of ops) this.apply(op);
  }

  clone(store = this.store.clone()): PolygonDocument {
    const copy = new PolygonDocument(store, this.ring.clone());
    copy.deletes = new Map(this.deletes);
    return copy;
  }

  /** The ring with no topology repair — what you'd get with zero safety net. For demos/comparison only. */
  materializeUnsafe(): Ring {
    return this.ring.toArray().map((id) => this.store.get(id)!.value);
  }

  materialize(): DocumentMergeResult {
    // Every vertex ever placed in this ring, in ring order, starting live at its creation position.
    const nodes = this.ring.allEntries();
    const index = new Map(nodes.map((node, i) => [idToString(node.value), i]));
    const position = nodes.map((node) => this.store.history(node.value)[0]!.position);
    const live = nodes.map(() => true);

    const edits: Edit[] = [];
    nodes.forEach((node, i) => {
      for (const write of this.store.history(node.value).slice(1)) {
        edits.push({ kind: "move", id: write.id, index: i, position: write.position });
      }
    });
    for (const op of this.deletes.values()) {
      const i = index.get(idToString(op.vertex));
      if (i !== undefined) edits.push({ kind: "delete", id: op.id, index: i });
    }
    edits.sort((a, b) => compareId(a.id, b.id));

    const currentRing = (): Ring => position.filter((_, i) => live[i]);
    const liveCount = () => live.filter(Boolean).length;
    const crossingCount = () => (liveCount() >= 3 ? findSelfIntersections(currentRing()).length : 0);

    let crossings = crossingCount();
    for (const edit of edits) {
      const i = edit.index;
      if (!live[i]) continue; // edits to an already-deleted vertex can't change the shape
      if (edit.kind === "move") {
        const previous = position[i]!;
        position[i] = edit.position;
        const after = crossingCount();
        if (after > crossings) position[i] = previous;
        else crossings = after;
      } else {
        if (liveCount() - 1 < 3) continue;
        live[i] = false;
        const after = crossingCount();
        if (after > crossings) live[i] = true;
        else crossings = after;
      }
    }

    if (liveCount() < 3) {
      return { polygon: [], conflicts: [], valid: false };
    }

    const conflicts: string[] = [];
    nodes.forEach((node, i) => {
      if (!live[i]) return;
      const heldBack = node.tombstone || !pointsEqual(position[i]!, this.store.get(node.value)!.value);
      if (heldBack) conflicts.push(idToString(node.value));
    });

    return { polygon: currentRing(), conflicts, valid: crossings === 0 };
  }
}
