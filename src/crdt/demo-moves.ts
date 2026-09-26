import { LamportClock, type OpId } from "./ids.js";
import { PolygonDocument } from "./document.js";
import { VertexStore } from "./vertex-store.js";
import type { InsertVertexOp, MoveVertexOp } from "./ops.js";
import type { Point } from "../types.js";

/**
 * Two crews fetch the same notched parcel boundary, go offline, and each
 * pull one corner of the notch down and across. Either edit alone leaves a
 * valid polygon; together the two notch edges cross. The same story as the
 * snapshot-diff demo, now running on real ops with real Lamport clocks.
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

// Each crew's clock observes the base document's clocks before going offline,
// so their own edits are guaranteed causally ahead of it.
const crewAClock = new LamportClock("crewA");
const crewBClock = new LamportClock("crewB");
for (const vertexId of vertexIds) {
  crewAClock.observe(vertexId);
  crewBClock.observe(vertexId);
}

const moveA: MoveVertexOp = { type: "move", id: crewAClock.tick(), vertex: vertexIds[3]!, position: [3, 2] };
const moveB: MoveVertexOp = { type: "move", id: crewBClock.tick(), vertex: vertexIds[4]!, position: [7, 2] };

export const crewAOnly = baseDoc.clone();
crewAOnly.apply(moveA);

export const crewBOnly = baseDoc.clone();
crewBOnly.apply(moveB);

export const mergedDoc = baseDoc.clone();
mergedDoc.apply(moveA);
mergedDoc.apply(moveB);

/** The same two edits, arriving in the opposite order. */
export const mergedReversed = baseDoc.clone();
mergedReversed.apply(moveB);
mergedReversed.apply(moveA);
