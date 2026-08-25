import type { Point, Ring } from "./types.js";

interface PolygonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: "Polygon";
    coordinates: [number, number][][];
  };
}

function pointsEqual(p: Point, q: Point): boolean {
  return p[0] === q[0] && p[1] === q[1];
}

/** Extracts the outer ring as an open ring (no repeated closing point). Holes aren't supported yet. */
export function ringFromFeature(feature: PolygonFeature): Ring {
  const outer = feature.geometry.coordinates[0];
  if (!outer) throw new Error("Polygon feature has no coordinates");
  const ring: Ring = outer.map(([x, y]) => [x, y]);
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (ring.length > 1 && pointsEqual(first, last)) ring.pop();
  return ring;
}

export function featureFromRing(ring: Ring, properties: Record<string, unknown> = {}): PolygonFeature {
  const closed = [...ring, ring[0]!];
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [closed],
    },
  };
}
