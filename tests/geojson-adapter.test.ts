import { describe, expect, it } from "vitest";
import { LamportClock } from "../src/crdt/ids.js";
import { documentFromFeature, featureFromMaterialized } from "../src/crdt/geojson-adapter.js";
import type { MoveVertexOp } from "../src/crdt/ops.js";

const square = {
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "Polygon" as const,
    coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as [number, number][]],
  },
};

describe("documentFromFeature", () => {
  it("loads a real GeoJSON polygon into a document that materializes back to the same ring", () => {
    const { document } = documentFromFeature(square, new LamportClock("loader"));
    const result = document.materialize();
    expect(result.valid).toBe(true);
    expect(result.polygon).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });

  it("round-trips through featureFromMaterialized", () => {
    const { document } = documentFromFeature(square, new LamportClock("loader"));
    const feature = featureFromMaterialized(document.materialize(), { name: "parcel" });
    expect(feature.geometry.coordinates[0]).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
    expect(feature.properties.name).toBe("parcel");
  });

  it("rejects a polygon with fewer than 3 vertices", () => {
    const degenerate = {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [1, 1], [0, 0]] as [number, number][]] },
    };
    expect(() => documentFromFeature(degenerate, new LamportClock("loader"))).toThrow();
  });

  it("loaded documents support further ops from a causally-later clock", () => {
    const loaderClock = new LamportClock("loader");
    const { document, vertexIds } = documentFromFeature(square, loaderClock);

    const editorClock = new LamportClock("editor");
    editorClock.observe(vertexIds[0]!);
    for (const id of vertexIds) editorClock.observe(id);

    const move: MoveVertexOp = { type: "move", id: editorClock.tick(), vertex: vertexIds[0]!, position: [1, 1] };
    document.apply(move);
    expect(document.materialize().polygon[0]).toEqual([1, 1]);
  });
});
