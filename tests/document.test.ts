import { describe, expect, it } from "vitest";
import { PolygonDocument } from "../src/crdt/document.js";
import { VertexStore } from "../src/crdt/vertex-store.js";
import { findSelfIntersections } from "../src/topology.js";
import type { OpId } from "../src/crdt/ids.js";
import type { InsertVertexOp, MoveVertexOp } from "../src/crdt/ops.js";
import type { Point } from "../src/types.js";

const id = (actor: string, clock: number): OpId => ({ actor, clock });

// Real code stamps ids via LamportClock, which folds in every remote clock a
// crew has observed so its own next op is always causally ahead. These
// tests build ids by hand for readability, so edits made *after* fetching
// the base document use clocks well above the base's highest (6) to stay
// causally valid — otherwise the LWW register would (correctly) treat them
// as stale writes and silently ignore them.

// The same notch-boundary hexagon used in the CLI demo: v0..v5, with a
// concave notch at v3/v4 where two crews independently drag their end
// outward.
const hexagon: [OpId, Point][] = [
  [id("base", 1), [0, 0]],
  [id("base", 2), [10, 0]],
  [id("base", 3), [10, 10]],
  [id("base", 4), [6, 4]],
  [id("base", 5), [4, 4]],
  [id("base", 6), [0, 10]],
];

function buildBaseDocument(): { doc: PolygonDocument; store: VertexStore; ids: OpId[] } {
  const store = new VertexStore();
  const doc = new PolygonDocument(store);
  let previous: OpId | null = null;
  const ids: OpId[] = [];
  for (const [vertexId, position] of hexagon) {
    const op: InsertVertexOp = { type: "insert", id: vertexId, after: previous, position };
    doc.apply(op);
    ids.push(vertexId);
    previous = vertexId;
  }
  return { doc, store, ids };
}

describe("PolygonDocument — concurrent moves", () => {
  it("stays a simple polygon when two crews independently drag opposite notch vertices", () => {
    const { doc, ids } = buildBaseDocument();
    const [, , , v3, v4] = ids;

    const merged = doc.clone();
    const moveA: MoveVertexOp = { type: "move", id: id("crewA", 100), vertex: v3!, position: [11, 6] };
    const moveB: MoveVertexOp = { type: "move", id: id("crewB", 100), vertex: v4!, position: [-1, 6] };

    // Unsafe view shows the actual bug: no repair, just whatever the ops say.
    merged.applyAll([moveA, moveB]);
    expect(findSelfIntersections(merged.materializeUnsafe())).not.toEqual([]);

    const result = merged.materialize();
    expect(result.valid).toBe(true);
    expect(findSelfIntersections(result.polygon)).toEqual([]);
  });

  it("produces an identical merge regardless of which crew's edit is applied first", () => {
    const base = buildBaseDocument();
    const [, , , v3, v4] = base.ids;
    const moveA: MoveVertexOp = { type: "move", id: id("crewA", 100), vertex: v3!, position: [11, 6] };
    const moveB: MoveVertexOp = { type: "move", id: id("crewB", 100), vertex: v4!, position: [-1, 6] };

    const forward = base.doc.clone();
    forward.applyAll([moveA, moveB]);

    const backward = base.doc.clone();
    backward.applyAll([moveB, moveA]);

    expect(forward.materialize()).toEqual(backward.materialize());
  });

  it("reports a genuine per-vertex conflict when both crews move the same vertex differently, without guessing", () => {
    const { doc, ids } = buildBaseDocument();
    const [v0] = ids;
    const moveA: MoveVertexOp = { type: "move", id: id("crewA", 100), vertex: v0!, position: [1, 1] };
    const moveB: MoveVertexOp = { type: "move", id: id("crewB", 101), vertex: v0!, position: [-1, -1] };

    doc.applyAll([moveA, moveB]);
    const result = doc.materialize();

    expect(result.valid).toBe(true);
    // crewB's op has the higher Lamport clock, so it wins the LWW register —
    // deterministic, not a guess, and the same regardless of application order.
    expect(result.polygon[0]).toEqual([-1, -1]);
  });
});

describe("PolygonDocument — concurrent inserts", () => {
  it("reports valid: false, with no guessed fix, when a crossing is caused entirely by brand-new unrevertible vertices", () => {
    const { doc, ids } = buildBaseDocument();
    const v1 = ids[1]!;

    const insertY: InsertVertexOp = { type: "insert", id: id("B", 10), after: v1, position: [11, 7] };
    const insertX: InsertVertexOp = { type: "insert", id: id("A", 9), after: v1, position: [11, 3] };

    const forward = doc.clone();
    forward.applyAll([insertY, insertX]);
    const forwardResult = forward.materialize();

    const backward = doc.clone();
    backward.applyAll([insertX, insertY]);
    const backwardResult = backward.materialize();

    // Same ring order and same (honest) outcome regardless of application order.
    expect(forwardResult).toEqual(backwardResult);
    expect(forwardResult.valid).toBe(false);
    expect(forwardResult.conflicts).toEqual([]);
  });

  it("lets a later insert anchor on a vertex the other crew concurrently deleted", () => {
    const { doc, ids } = buildBaseDocument();
    const v1 = ids[1]!;

    const deleteV1 = { type: "delete" as const, id: id("crewA", 100), vertex: v1 };
    const insertAfterV1: InsertVertexOp = { type: "insert", id: id("crewB", 100), after: v1, position: [10, 1] };

    expect(() => doc.applyAll([deleteV1, insertAfterV1])).not.toThrow();
    const result = doc.materialize();
    expect(result.polygon).not.toContainEqual([10, 0]); // v1 itself is gone
    expect(result.polygon).toContainEqual([10, 1]); // but the insert anchored on it survived
  });
});

describe("PolygonDocument — structural degeneracy", () => {
  it("refuses the delete that would drop the ring below 3 vertices, and flags it", () => {
    // A square: either crew's delete alone leaves a valid triangle, but both
    // together would leave 2 vertices.
    const doc = new PolygonDocument(new VertexStore());
    const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const ids = square.map((_, i) => id("base", i + 1));
    square.forEach((position, i) => doc.apply({ type: "insert", id: ids[i]!, after: i ? ids[i - 1]! : null, position }));
    doc.apply({ type: "delete", id: id("crewA", 100), vertex: ids[0]! });
    doc.apply({ type: "delete", id: id("crewB", 100), vertex: ids[1]! });

    // Canonical order: crewA:100 then crewB:100. The first leaves a triangle;
    // the second would leave 2 vertices, so it's refused and flagged.
    const result = doc.materialize();
    expect(result.valid).toBe(true);
    expect(result.polygon).toEqual([[10, 0], [10, 10], [0, 10]]);
    expect(result.conflicts).toEqual([`${ids[1]!.actor}:${ids[1]!.clock}`]);
  });
});

describe("PolygonDocument — three or more concurrent editors", () => {
  it("applies non-conflicting concurrent edits from three actors regardless of application order", () => {
    const base = buildBaseDocument();
    const [v0, , v2, , , v5] = base.ids;
    const moveA: MoveVertexOp = { type: "move", id: id("crewA", 100), vertex: v0!, position: [-2, -2] };
    const moveB: MoveVertexOp = { type: "move", id: id("crewB", 100), vertex: v2!, position: [12, 12] };
    const moveC: MoveVertexOp = { type: "move", id: id("crewC", 100), vertex: v5!, position: [-2, 12] };
    const ops = [moveA, moveB, moveC];

    const permutations = [
      [ops[0]!, ops[1]!, ops[2]!],
      [ops[2]!, ops[0]!, ops[1]!],
      [ops[1]!, ops[2]!, ops[0]!],
    ];

    const results = permutations.map((order) => {
      const doc = base.doc.clone();
      doc.applyAll(order);
      return doc.materialize();
    });

    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0]!.valid).toBe(true);
    expect(results[0]!.polygon).toContainEqual([-2, -2]);
    expect(results[0]!.polygon).toContainEqual([12, 12]);
    expect(results[0]!.polygon).toContainEqual([-2, 12]);
  });

  it("still isolates just the conflicting vertices when a third, unrelated editor is also concurrent", () => {
    const base = buildBaseDocument();
    const [v0, , , v3, v4] = base.ids;
    // crewA's edit alone pushes v3 past the polygon's own right edge — that's
    // the actual conflict. crewB and crewC each make an ordinary interior
    // move to a vertex that doesn't participate in the resulting crossing.
    const moveA: MoveVertexOp = { type: "move", id: id("crewA", 100), vertex: v3!, position: [11, 6] };
    const moveB: MoveVertexOp = { type: "move", id: id("crewB", 100), vertex: v4!, position: [5, 4.5] };
    const moveC: MoveVertexOp = { type: "move", id: id("crewC", 100), vertex: v0!, position: [-0.2, -0.2] };

    const doc = base.doc.clone();
    doc.applyAll([moveA, moveB, moveC]);
    const result = doc.materialize();

    expect(result.valid).toBe(true);
    // Only crewA's move adds a crossing, so only v3 is held back. crewB's move
    // of v4 shares the notch edge with v3 but is harmless, and is kept.
    expect(result.conflicts).toEqual([`${v3!.actor}:${v3!.clock}`]);
    expect(result.polygon).toContainEqual([5, 4.5]);
    expect(result.polygon).toContainEqual([-0.2, -0.2]); // crewC's edit shares no edge with the conflict and survives untouched
  });
});

describe("PolygonDocument — shared vertices across two features", () => {
  it("keeps a boundary vertex consistent across both parcels that reference it", () => {
    const store = new VertexStore();

    // Parcel P: p0 -> p1 -> p2 -> p3 -> (back to p0). p2/p3 are the shared edge.
    const p0 = id("base", 1);
    const p1 = id("base", 2);
    const p2 = id("base", 3);
    const p3 = id("base", 4);
    const parcelP = new PolygonDocument(store);
    parcelP.apply({ type: "insert", id: p0, after: null, position: [0, 0] });
    parcelP.apply({ type: "insert", id: p1, after: p0, position: [10, 0] });
    parcelP.apply({ type: "insert", id: p2, after: p1, position: [10, 10] });
    parcelP.apply({ type: "insert", id: p3, after: p2, position: [0, 10] });
    parcelP.materialize();

    // Parcel Q shares p3/p2 (traced in the opposite direction) and adds its own two vertices.
    const q0 = id("base", 5);
    const q1 = id("base", 6);
    const parcelQ = new PolygonDocument(store);
    parcelQ.reference(p3, null); // p3 and p2 already exist in the shared store (created by parcel P)
    parcelQ.reference(p2, p3);
    parcelQ.apply({ type: "insert", id: q0, after: p2, position: [10, 20] });
    parcelQ.apply({ type: "insert", id: q1, after: q0, position: [0, 20] });
    parcelQ.materialize();

    // A crew moves the shared vertex p2 through parcel P's op stream only.
    parcelP.apply({ type: "move", id: id("crewA", 100), vertex: p2, position: [10, 11] });

    const resultP = parcelP.materialize();
    const resultQ = parcelQ.materialize();

    expect(resultP.valid).toBe(true);
    expect(resultQ.valid).toBe(true);
    expect(resultP.polygon).toContainEqual([10, 11]);
    expect(resultQ.polygon).toContainEqual([10, 11]); // same vertex, same new position, no re-sync needed
  });
});
