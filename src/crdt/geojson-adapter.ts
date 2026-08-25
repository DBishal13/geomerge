import { LamportClock, type OpId } from "./ids.js";
import { PolygonDocument, type DocumentMergeResult } from "./document.js";
import { VertexStore } from "./vertex-store.js";
import type { InsertVertexOp } from "./ops.js";
import { ringFromFeature, featureFromRing } from "../geojson.js";

interface PolygonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
}

/**
 * Synthesizes the genesis insert ops for a real GeoJSON Polygon: one op per
 * ring vertex, chained in file order, stamped by `clock` (pass one already
 * seeded from anything the caller has previously synced, so these ids are
 * causally ahead of it). Pure op synthesis, no document — this is what the
 * HTTP API uses so the ops go through the normal persisted-push path rather
 * than a separate code path.
 */
export function opsFromFeature(feature: PolygonFeature, clock: LamportClock): { ops: InsertVertexOp[]; vertexIds: OpId[] } {
  const ring = ringFromFeature(feature);
  if (ring.length < 3) {
    throw new Error(`opsFromFeature: polygon has only ${ring.length} vertices, need at least 3`);
  }

  const ops: InsertVertexOp[] = [];
  const vertexIds: OpId[] = [];
  let previous: OpId | null = null;
  for (const position of ring) {
    const id = clock.tick();
    ops.push({ type: "insert", id, after: previous, position });
    vertexIds.push(id);
    previous = id;
  }
  return { ops, vertexIds };
}

/**
 * Loads a real GeoJSON Polygon as a brand-new, checkpointed `PolygonDocument`
 * — for direct in-process use (demos, tests). Checkpoints immediately since
 * the loaded ring is valid by construction, so it's ready for
 * `materialize()` to revert into on a later merge.
 */
export function documentFromFeature(
  feature: PolygonFeature,
  clock: LamportClock,
  store: VertexStore = new VertexStore(),
): { document: PolygonDocument; store: VertexStore; vertexIds: OpId[] } {
  const { ops, vertexIds } = opsFromFeature(feature, clock);
  const document = new PolygonDocument(store);
  document.applyAll(ops);
  document.materialize();
  return { document, store, vertexIds };
}

export function featureFromMaterialized(result: DocumentMergeResult, properties: Record<string, unknown> = {}) {
  return featureFromRing(result.polygon, { ...properties, conflicts: result.conflicts, valid: result.valid });
}
