import type { Point, Ring } from "./types.js";

/**
 * A shared parcel boundary with a notch (v3/v4) where two neighboring crews
 * each drag their own end of the shared edge outward, offline, at the same
 * time. Neither edit touches a vertex the other touched — so a naive merge
 * sees no conflict and applies both — but combined they fold the boundary
 * over itself.
 */
export const base: Ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [6, 4],
  [4, 4],
  [0, 10],
];

export const crewA: Ring = base.map((p, i): Point => (i === 3 ? [11, 6] : p));
export const crewB: Ring = base.map((p, i): Point => (i === 4 ? [-1, 6] : p));
