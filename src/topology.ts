import type { Point, Ring } from "./types.js";

export interface EdgeCrossing {
  edgeI: number;
  edgeJ: number;
}

function orientation(p: Point, q: Point, r: Point): number {
  const cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (Math.abs(cross) < 1e-9) return 0;
  return cross > 0 ? 1 : -1;
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    Math.min(p[0], r[0]) - 1e-9 <= q[0] &&
    q[0] <= Math.max(p[0], r[0]) + 1e-9 &&
    Math.min(p[1], r[1]) - 1e-9 <= q[1] &&
    q[1] <= Math.max(p[1], r[1]) + 1e-9
  );
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = orientation(p3, p4, p1);
  const d2 = orientation(p3, p4, p2);
  const d3 = orientation(p1, p2, p3);
  const d4 = orientation(p1, p2, p4);

  if (d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0) {
    return d1 !== d2 && d3 !== d4;
  }

  // Collinear/touching edge cases.
  if (d1 === 0 && onSegment(p3, p1, p4)) return true;
  if (d2 === 0 && onSegment(p3, p2, p4)) return true;
  if (d3 === 0 && onSegment(p1, p3, p2)) return true;
  if (d4 === 0 && onSegment(p1, p4, p2)) return true;
  return false;
}

/**
 * Finds pairs of non-adjacent edges that cross. Adjacent edges (sharing a
 * vertex) are skipped since they legitimately touch at that shared point.
 */
export function findSelfIntersections(ring: Ring): EdgeCrossing[] {
  const n = ring.length;
  const crossings: EdgeCrossing[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === (i + 1) % n) continue;
      if ((j + 1) % n === i) continue;

      const a1 = ring[i]!;
      const a2 = ring[(i + 1) % n]!;
      const b1 = ring[j]!;
      const b2 = ring[(j + 1) % n]!;

      if (segmentsIntersect(a1, a2, b1, b2)) {
        crossings.push({ edgeI: i, edgeJ: j });
      }
    }
  }

  return crossings;
}

export function isSimplePolygon(ring: Ring): boolean {
  return findSelfIntersections(ring).length === 0;
}
