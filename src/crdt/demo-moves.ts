import { LamportClock, type OpId } from "./ids.js";
import { PolygonDocument } from "./document.js";
import { VertexStore } from "./vertex-store.js";
import type { InsertVertexOp, MoveVertexOp } from "./ops.js";
import type { Point } from "../types.js";

/**
 * Two crews fetch the same notched parcel boundary, go offline, and each
 * drag their end of the notch outward — the same story as the earlier
 * snapshot-diff demo, now running on real ops with real Lamport clocks
 * instead of a one-shot base/a/b diff.
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
baseDoc.materialize(); // checkpoint: base is valid by construction

// Each crew's clock observes the base document's clocks before going offline,
// so their own edits are guaranteed causally ahead of it.
const crewAClock = new LamportClock("crewA");
const crewBClock = new LamportClock("crewB");
for (const vertexId of vertexIds) {
  crewAClock.observe(vertexId);
  crewBClock.observe(vertexId);
}

const moveA: MoveVertexOp = { type: "move", id: crewAClock.tick(), vertex: vertexIds[3]!, position: [11, 6] };
const moveB: MoveVertexOp = { type: "move", id: crewBClock.tick(), vertex: vertexIds[4]!, position: [-1, 6] };

export const mergedDoc = baseDoc.clone();
mergedDoc.apply(moveA);
mergedDoc.apply(moveB);
