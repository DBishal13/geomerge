import { LamportClock, type OpId } from "./ids.js";
import { PolygonDocument } from "./document.js";
import { VertexStore } from "./vertex-store.js";
import type { InsertVertexOp } from "./ops.js";
import type { Point } from "../types.js";

/**
 * Two crews independently add a new boundary point on the same edge —
 * inserts, not moves, which the earlier snapshot-diff engine couldn't
 * represent at all (fixed vertex count). Both new vertices are brand new
 * with no prior valid position, so if they combine into a crossing there's
 * nothing safe to revert them to: `materialize()` honestly reports
 * `valid: false` instead of guessing a fix.
 */
const hexagon: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [6, 4],
  [4, 4],
  [0, 10],
];

const baseClock = new LamportClock("base");
const store = new VertexStore();
export const baseDoc = new PolygonDocument(store);

const vertexIds: OpId[] = [];
let previous: OpId | null = null;
for (const position of hexagon) {
  const opId = baseClock.tick();
  const op: InsertVertexOp = { type: "insert", id: opId, after: previous, position };
  baseDoc.apply(op);
  vertexIds.push(opId);
  previous = opId;
}
baseDoc.materialize();

const crewAClock = new LamportClock("crewA");
const crewBClock = new LamportClock("crewB");
for (const vertexId of vertexIds) {
  crewAClock.observe(vertexId);
  crewBClock.observe(vertexId);
}

// Both crews add a point on the same edge (between v1 and v2), bulging outward
// at different heights.
const insertA: InsertVertexOp = { type: "insert", id: crewAClock.tick(), after: vertexIds[1]!, position: [11, 3] };
const insertB: InsertVertexOp = { type: "insert", id: crewBClock.tick(), after: vertexIds[1]!, position: [11, 7] };

export const mergedDoc = baseDoc.clone();
mergedDoc.apply(insertA);
mergedDoc.apply(insertB);
