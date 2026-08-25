import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpLogStore } from "../src/store/op-log.js";
import { DocumentStore } from "../src/store/document-store.js";
import type { InsertVertexOp, MoveVertexOp } from "../src/crdt/ops.js";
import type { OpId } from "../src/crdt/ids.js";

const tmpDirs: string[] = [];
function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "geomerge-test-"));
  tmpDirs.push(dir);
  return join(dir, "test.sqlite");
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const id = (actor: string, clock: number): OpId => ({ actor, clock });
const hexagon: [number, number][] = [[0, 0], [10, 0], [10, 10], [6, 4], [4, 4], [0, 10]];

function genesisOps(): { ops: InsertVertexOp[]; vertexIds: OpId[] } {
  const vertexIds: OpId[] = [];
  const ops: InsertVertexOp[] = [];
  let previous: OpId | null = null;
  hexagon.forEach(([x, y], i) => {
    const vertexId = id("base", i + 1);
    ops.push({ type: "insert", id: vertexId, after: previous, position: [x, y] });
    vertexIds.push(vertexId);
    previous = vertexId;
  });
  return { ops, vertexIds };
}

describe("DocumentStore", () => {
  it("create + push + materialize round-trips through a live document", () => {
    const store = new DocumentStore(new OpLogStore());
    const { ops, vertexIds } = genesisOps();
    const createResult = store.create("parcel-1", ops);
    expect(createResult.valid).toBe(true);

    const [, , , v3, v4] = vertexIds;
    const moveA: MoveVertexOp = { type: "move", id: id("crewA", 100), vertex: v3!, position: [11, 6] };
    const moveB: MoveVertexOp = { type: "move", id: id("crewB", 100), vertex: v4!, position: [-1, 6] };
    const { result } = store.push("parcel-1", [moveA, moveB]);

    expect(result.valid).toBe(true);
    expect(result.conflicts).toEqual([`${v3!.actor}:${v3!.clock}`, `${v4!.actor}:${v4!.clock}`]);
    expect(store.materialize("parcel-1")).toEqual(result);
  });

  it("preserves the incremental checkpoint history across a restart, not just the raw ops", () => {
    const path = tmpDbPath();
    const { ops, vertexIds } = genesisOps();
    const [, , , v3, v4] = vertexIds;
    const moveA: MoveVertexOp = { type: "move", id: id("crewA", 100), vertex: v3!, position: [11, 6] };
    const moveB: MoveVertexOp = { type: "move", id: id("crewB", 100), vertex: v4!, position: [-1, 6] };

    const before = new DocumentStore(new OpLogStore(path));
    before.create("parcel-1", ops); // batch 1: genesis, checkpointed valid
    const liveResult = before.push("parcel-1", [moveA, moveB]).result; // batch 2: conflict, repaired

    // Simulate a server restart: fresh OpLogStore + DocumentStore over the same file.
    const after = new DocumentStore(new OpLogStore(path));
    const reloadedResult = after.materialize("parcel-1");

    expect(reloadedResult).toEqual(liveResult);
    expect(reloadedResult.valid).toBe(true);
    expect(reloadedResult.conflicts).toEqual([`${v3!.actor}:${v3!.clock}`, `${v4!.actor}:${v4!.clock}`]);
  });

  it("pulls only new ops via opsSince, for a device catching up", () => {
    const store = new DocumentStore(new OpLogStore());
    const { ops } = genesisOps();
    store.create("parcel-1", ops);

    const deviceSeenSeq = store.latestSeq("parcel-1");
    store.push("parcel-1", [{ type: "move", id: id("crewA", 100), vertex: ops[0]!.id, position: [-1, -1] }]);

    const newOps = store.opsSince("parcel-1", deviceSeenSeq);
    expect(newOps).toHaveLength(1);
    expect(newOps[0]!.op.type).toBe("move");
  });
});
