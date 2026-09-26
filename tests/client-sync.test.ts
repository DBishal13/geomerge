import { describe, expect, it, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { OpLogStore } from "../src/store/op-log.js";
import { DocumentStore } from "../src/store/document-store.js";
import { GeomergeDevice } from "../src/client/device.js";
import type { MoveVertexOp, PolygonOp } from "../src/crdt/ops.js";

const API_KEY = "integration-test-key";

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

function startServer(): Promise<string> {
  const app = createApp({ documentStore: new DocumentStore(new OpLogStore()), apiKeys: new Set([API_KEY]) });
  server = createServer(app);
  return new Promise((resolve) => {
    server!.listen(0, () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

const notch = {
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "Polygon" as const,
    coordinates: [[[0, 0], [10, 0], [10, 10], [6, 4], [4, 4], [0, 10], [0, 0]] as [number, number][]],
  },
};

describe("end-to-end offline sync over a real HTTP server", () => {
  it("two devices, editing independently offline, converge to the same state after syncing through the server", async () => {
    const baseUrl = await startServer();

    // Admin/setup: create the document. (Not a device concern — devices join an existing document.)
    await fetch(`${baseUrl}/v1/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ id: "notch", feature: notch }),
    });

    const deviceA = new GeomergeDevice(baseUrl, API_KEY, "notch", "crewA");
    const deviceB = new GeomergeDevice(baseUrl, API_KEY, "notch", "crewB");

    // Both devices fetch the current document before going offline.
    const genesisA = await deviceA.syncPull();
    await deviceB.syncPull();
    expect(genesisA).toHaveLength(6);
    const v3 = genesisA[3]!.type === "insert" ? genesisA[3]!.id : undefined;
    const v4 = genesisA[4]!.type === "insert" ? genesisA[4]!.id : undefined;
    expect(v3).toBeDefined();
    expect(v4).toBeDefined();

    // Both go offline and edit independently — no network calls between these two lines.
    // Each crew pulls one notch corner down. Either edit alone is valid.
    const moveA: MoveVertexOp = { type: "move", id: deviceA.clock.tick(), vertex: v3!, position: [3, 2] };
    deviceA.editLocally([moveA]);
    const moveB: MoveVertexOp = { type: "move", id: deviceB.clock.tick(), vertex: v4!, position: [7, 2] };
    deviceB.editLocally([moveB]);

    // Offline, each device sees its own edit applied, with nothing held back.
    expect(deviceA.localState()).toMatchObject({ valid: true, conflicts: [] });
    expect(deviceA.localState().polygon[3]).toEqual([3, 2]);
    expect(deviceB.localState()).toMatchObject({ valid: true, conflicts: [] });
    expect(deviceB.localState().polygon[4]).toEqual([7, 2]);

    // Back online: push local edits, then pull whatever the other device pushed.
    // Both devices' watermarks are still at the genesis pull (6) — a push
    // response only confirms *your own* ops landed, not that you've seen
    // everything before them (see device.ts's docstring) — so both need a
    // real pull to find out about the other's op.
    await deviceA.syncPush([moveA]);
    await deviceB.syncPush([moveB]);
    const pulledByA = await deviceA.syncPull();
    const pulledByB = await deviceB.syncPull();
    expect(pulledByA.map((op: PolygonOp) => op.type)).toEqual(["move"]); // B's move — A's own is deduped
    expect(pulledByB.map((op: PolygonOp) => op.type)).toEqual(["move"]); // A's move — B's own is deduped

    const stateA = deviceA.localState();
    const stateB = deviceB.localState();
    const serverState = (await (
      await fetch(`${baseUrl}/v1/documents/notch`, { headers: { Authorization: `Bearer ${API_KEY}` } })
    ).json()) as { geometry: { coordinates: [number, number][][] }; properties: { conflicts: string[] } };

    // Together the two edits cross. Both devices and the server agree on the
    // same repair: crewA's move sorts first and is kept; crewB's is held back.
    expect(stateA).toEqual(stateB);
    expect(stateA.valid).toBe(true);
    expect(stateA.polygon[3]).toEqual([3, 2]);
    expect(stateA.polygon[4]).toEqual([4, 4]);
    expect(stateA.conflicts).toEqual([`${v4!.actor}:${v4!.clock}`]);
    expect(serverState.geometry.coordinates[0]).toEqual([stateA.polygon[0], ...stateA.polygon.slice(1), stateA.polygon[0]]);
    expect(serverState.properties.conflicts).toEqual(stateA.conflicts);
  });
});
