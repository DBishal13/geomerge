import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server/app.js";
import { OpLogStore } from "../src/store/op-log.js";
import { DocumentStore } from "../src/store/document-store.js";

const square = {
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "Polygon" as const,
    coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as [number, number][]],
  },
};

function freshApp(apiKeys: string[] = ["test-key"]) {
  const documentStore = new DocumentStore(new OpLogStore());
  return createApp({ documentStore, apiKeys: new Set(apiKeys) });
}

describe("HTTP API — auth", () => {
  it("rejects requests with no Authorization header", async () => {
    const app = freshApp();
    const res = await request(app).get("/v1/documents");
    expect(res.status).toBe(401);
  });

  it("rejects requests with a wrong key", async () => {
    const app = freshApp();
    const res = await request(app).get("/v1/documents").set("Authorization", "Bearer wrong");
    expect(res.status).toBe(401);
  });

  it("allows /healthz with no auth", async () => {
    const app = freshApp();
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
  });

  it("disables auth entirely when no keys are configured", async () => {
    const app = freshApp([]);
    const res = await request(app).get("/v1/documents");
    expect(res.status).toBe(200);
  });
});

describe("HTTP API — documents", () => {
  it("creates a document from a GeoJSON feature and materializes it back", async () => {
    const app = freshApp();
    const auth = ["Authorization", "Bearer test-key"] as const;

    const created = await request(app).post("/v1/documents").set(...auth).send({ id: "square-1", feature: square });
    expect(created.status).toBe(201);
    expect(created.body.geometry.coordinates[0]).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);

    const fetched = await request(app).get("/v1/documents/square-1").set(...auth);
    expect(fetched.status).toBe(200);
    expect(fetched.body.geometry).toEqual(created.body.geometry);
  });

  it("404s for an unknown document", async () => {
    const app = freshApp();
    const res = await request(app).get("/v1/documents/nope").set("Authorization", "Bearer test-key");
    expect(res.status).toBe(404);
  });

  it("409s creating a document id that already exists", async () => {
    const app = freshApp();
    const auth = ["Authorization", "Bearer test-key"] as const;
    await request(app).post("/v1/documents").set(...auth).send({ id: "dup", feature: square });
    const res = await request(app).post("/v1/documents").set(...auth).send({ id: "dup", feature: square });
    expect(res.status).toBe(409);
  });

  it("400s a request with neither feature nor ops", async () => {
    const app = freshApp();
    const res = await request(app)
      .post("/v1/documents")
      .set("Authorization", "Bearer test-key")
      .send({ id: "bad" });
    expect(res.status).toBe(400);
  });

  it("400s a malformed op", async () => {
    const app = freshApp();
    const auth = ["Authorization", "Bearer test-key"] as const;
    await request(app).post("/v1/documents").set(...auth).send({ id: "square-1", feature: square });
    const res = await request(app)
      .post("/v1/documents/square-1/ops")
      .set(...auth)
      .send({ ops: [{ type: "move", id: { actor: "a" } }] }); // missing clock, vertex, position
    expect(res.status).toBe(400);
  });

  it("full sync loop: push a conflicting merge, then pull ops from another device", async () => {
    const app = freshApp();
    const auth = ["Authorization", "Bearer test-key"] as const;

    const notch = {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "Polygon" as const,
        coordinates: [[[0, 0], [10, 0], [10, 10], [6, 4], [4, 4], [0, 10], [0, 0]] as [number, number][]],
      },
    };
    await request(app).post("/v1/documents").set(...auth).send({ id: "notch", feature: notch });

    const genesis = await request(app).get("/v1/documents/notch/ops?since=0").set(...auth);
    const v3 = genesis.body.ops[3].op.id;
    const v4 = genesis.body.ops[4].op.id;
    const deviceSeenSeq = genesis.body.ops.at(-1).seq;

    const pushed = await request(app)
      .post("/v1/documents/notch/ops")
      .set(...auth)
      .send({
        ops: [
          { type: "move", id: { actor: "crewA", clock: 100 }, vertex: v3, position: [11, 6] },
          { type: "move", id: { actor: "crewB", clock: 100 }, vertex: v4, position: [-1, 6] },
        ],
      });
    expect(pushed.status).toBe(201);
    expect(pushed.body.properties.valid).toBe(true);
    expect(pushed.body.properties.conflicts).toHaveLength(2);

    // A second device that only saw the genesis batch pulls the new ops.
    const pulled = await request(app).get(`/v1/documents/notch/ops?since=${deviceSeenSeq}`).set(...auth);
    expect(pulled.body.ops).toHaveLength(2);
    expect(pulled.body.ops.map((s: { op: { type: string } }) => s.op.type)).toEqual(["move", "move"]);
  });

  it("lists document ids", async () => {
    const app = freshApp();
    const auth = ["Authorization", "Bearer test-key"] as const;
    await request(app).post("/v1/documents").set(...auth).send({ id: "a", feature: square });
    await request(app).post("/v1/documents").set(...auth).send({ id: "b", feature: square });
    const res = await request(app).get("/v1/documents").set(...auth);
    expect(res.body.documents.sort()).toEqual(["a", "b"]);
  });
});
