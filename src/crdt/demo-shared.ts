import { LamportClock, type OpId } from "./ids.js";
import { PolygonDocument } from "./document.js";
import { VertexStore } from "./vertex-store.js";
import type { Point } from "../types.js";

/**
 * The literal product primitive: two neighboring parcels, P and Q, whose
 * documents share a `VertexStore` and both reference the same two boundary
 * vertices. Moving that boundary through *either* parcel's op stream is
 * visible in both — there's no separate "sync the shared edge" step,
 * because it was never two copies of the edge to begin with.
 */
const store = new VertexStore();
const baseClock = new LamportClock("base");

const p0 = baseClock.tick();
const p1 = baseClock.tick();
const p2 = baseClock.tick();
const p3 = baseClock.tick();

export const parcelP = new PolygonDocument(store);
parcelP.apply({ type: "insert", id: p0, after: null, position: [0, 0] });
parcelP.apply({ type: "insert", id: p1, after: p0, position: [10, 0] });
parcelP.apply({ type: "insert", id: p2, after: p1, position: [10, 10] });
parcelP.apply({ type: "insert", id: p3, after: p2, position: [0, 10] });
parcelP.materialize();

const q0 = baseClock.tick();
const q1 = baseClock.tick();

export const parcelQ = new PolygonDocument(store);
parcelQ.reference(p3, null); // shared boundary vertices — already created by parcel P
parcelQ.reference(p2, p3);
parcelQ.apply({ type: "insert", id: q0, after: p2, position: [10, 20] });
parcelQ.apply({ type: "insert", id: q1, after: q0, position: [0, 20] });
parcelQ.materialize();

export const sharedVertexIds: { p2: OpId; p3: OpId } = { p2, p3 };

const crewClock = new LamportClock("crewA");
crewClock.observe(q1);

/** A crew nudges the shared boundary outward — through parcel P's op stream only. */
export function moveSharedBoundary(): void {
  parcelP.apply({ type: "move", id: crewClock.tick(), vertex: p2, position: [10, 12] });
}
