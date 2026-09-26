import { describe, expect, it } from "vitest";
import { PolygonDocument } from "../src/crdt/document.js";
import { VertexStore } from "../src/crdt/vertex-store.js";
import { findSelfIntersections } from "../src/topology.js";
import type { OpId } from "../src/crdt/ids.js";
import type { InsertVertexOp, MoveVertexOp, PolygonOp } from "../src/crdt/ops.js";
import type { Point } from "../src/types.js";

// The repaired polygon must depend only on *which* ops a replica holds —
// not the order they arrived in, and not how often the replica called
// materialize() along the way. These tests pin that down.

const id = (actor: string, clock: number): OpId => ({ actor, clock });
const hexagon: Point[] = [[0, 0], [10, 0], [10, 10], [6, 4], [4, 4], [0, 10]];
const baseIds = hexagon.map((_, i) => id("base", i + 1));
const genesis: InsertVertexOp[] = hexagon.map((position, i) => ({
  type: "insert",
  id: baseIds[i]!,
  after: i ? baseIds[i - 1]! : null,
  position,
}));

/** A replica that receives `batches` one at a time, materializing after each. */
function replica(batches: PolygonOp[][]) {
  const doc = new PolygonDocument(new VertexStore());
  doc.applyAll(genesis);
  doc.materialize();
  for (const batch of batches) {
    doc.applyAll(batch);
    doc.materialize();
  }
  return doc.materialize();
}

describe("materialize() convergence", () => {
  // Each crew pulls a notch corner downward. Either edit alone is valid;
  // together the two notch edges cross.
  const moveA: MoveVertexOp = { type: "move", id: id("crewA", 7), vertex: baseIds[3]!, position: [3, 2] };
  const moveB: MoveVertexOp = { type: "move", id: id("crewB", 7), vertex: baseIds[4]!, position: [7, 2] };

  it("uses a scenario where each edit is valid alone but the pair is not", () => {
    const withMove = (i: number, p: Point) => hexagon.map((q, j) => (j === i ? p : q));
    expect(findSelfIntersections(withMove(3, [3, 2]))).toEqual([]);
    expect(findSelfIntersections(withMove(4, [7, 2]))).toEqual([]);
    expect(findSelfIntersections(withMove(3, [3, 2]).map((q, j) => (j === 4 ? ([7, 2] as Point) : q)))).not.toEqual([]);
  });

  it("gives the same result whichever edit a replica hears about first", () => {
    const aThenB = replica([[moveA], [moveB]]);
    const bThenA = replica([[moveB], [moveA]]);
    const together = replica([[moveA, moveB]]);

    expect(bThenA).toEqual(aThenB);
    expect(together).toEqual(aThenB);

    // crewA:7 sorts before crewB:7, so A's edit is kept and B's is held back.
    expect(aThenB.valid).toBe(true);
    expect(aThenB.polygon[3]).toEqual([3, 2]);
    expect(aThenB.polygon[4]).toEqual([4, 4]);
    expect(aThenB.conflicts).toEqual(["base:5"]);
  });

  it("converges for random edits from three crews, in any arrival order", () => {
    let seed = 42;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)]!;

    for (let trial = 0; trial < 200; trial++) {
      // Each crew makes 1-3 moves or deletes on base vertices, stamped above the base clocks.
      const ops: PolygonOp[] = [];
      for (const actor of ["crewA", "crewB", "crewC"]) {
        const count = 1 + Math.floor(random() * 3);
        for (let k = 0; k < count; k++) {
          const opId = id(actor, 7 + k);
          const vertex = pick(baseIds);
          ops.push(
            random() < 0.8
              ? { type: "move", id: opId, vertex, position: [Math.round(random() * 14 - 2), Math.round(random() * 14 - 2)] }
              : { type: "delete", id: opId, vertex },
          );
        }
      }

      const results = Array.from({ length: 4 }, () => {
        // Shuffle, then split into random batches (a materialize() between each).
        const shuffled = [...ops].sort(() => random() - 0.5);
        const batches: PolygonOp[][] = [];
        for (const op of shuffled) {
          if (batches.length === 0 || random() < 0.5) batches.push([]);
          batches[batches.length - 1]!.push(op);
        }
        return replica(batches);
      });

      for (const result of results) {
        expect(result).toEqual(results[0]);
        expect(result.valid).toBe(true);
        expect(findSelfIntersections(result.polygon)).toEqual([]);
      }
    }
  });
});
