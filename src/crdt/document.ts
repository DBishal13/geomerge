import { idToString, type OpId } from "./ids.js";
import { RgaList } from "./rga.js";
import { VertexStore } from "./vertex-store.js";
import type { PolygonOp } from "./ops.js";
import type { Point, Ring } from "../types.js";
import { findSelfIntersections } from "../topology.js";

export interface DocumentMergeResult {
  polygon: Ring;
  /** Vertex ids (as strings) that were reverted to their last known-valid position. */
  conflicts: string[];
  valid: boolean;
}

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
 * `materialize()` is the topology guarantee: it always returns a simple
 * polygon. Vertices whose edits (moves, or being newly inserted) combine to
 * cross an edge are reverted to their last known-valid position and listed
 * in `conflicts`, rather than silently handed back as a self-intersecting
 * shape. A vertex with no prior valid position (freshly inserted, never
 * checkpointed) can't be reverted, so if it's the only thing implicated in
 * a crossing, `materialize()` reports `valid: false` instead of guessing.
 */
export class PolygonDocument {
  private lastValidPositions = new Map<string, Point>();

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
    copy.lastValidPositions = new Map(this.lastValidPositions);
    return copy;
  }

  /** The ring with no topology repair — what you'd get with zero safety net. For demos/comparison only. */
  materializeUnsafe(): Ring {
    return this.ring.toArray().map((id) => this.store.get(id)!.value);
  }

  materialize(): DocumentMergeResult {
    const vertexIds = this.ring.toArray();
    const attempted = vertexIds.map((id) => this.store.get(id)!.value);
    const key = (id: OpId) => idToString(id);

    const changed = vertexIds.map((id, i) => {
      const lastValid = this.lastValidPositions.get(key(id));
      return lastValid === undefined || !pointsEqual(lastValid, attempted[i]!);
    });
    const revertible = vertexIds.map((id) => this.lastValidPositions.has(key(id)));

    const reverted = new Set<number>();
    const applyReverts = (): Ring =>
      attempted.map((pt, i) => {
        if (!reverted.has(i)) return pt;
        return this.lastValidPositions.get(key(vertexIds[i]!)) ?? pt;
      });

    let ring = applyReverts();
    let crossings = findSelfIntersections(ring);

    let guard = vertexIds.length + 1;
    while (crossings.length > 0 && guard-- > 0) {
      let progressed = false;
      for (const { edgeI, edgeJ } of crossings) {
        for (const idx of [edgeI, (edgeI + 1) % ring.length, edgeJ, (edgeJ + 1) % ring.length]) {
          if (changed[idx] && revertible[idx] && !reverted.has(idx)) {
            reverted.add(idx);
            progressed = true;
          }
        }
      }
      if (!progressed) break; // remaining crossing isn't ours to fix (unrevertible or pre-existing)
      ring = applyReverts();
      crossings = findSelfIntersections(ring);
    }

    const valid = crossings.length === 0;
    if (valid) {
      this.lastValidPositions = new Map(vertexIds.map((id, i) => [key(id), ring[i]!]));
    }

    return {
      polygon: ring,
      conflicts: Array.from(reverted)
        .sort((a, b) => a - b)
        .map((i) => key(vertexIds[i]!)),
      valid,
    };
  }
}
