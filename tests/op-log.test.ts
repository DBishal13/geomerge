import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpLogStore } from "../src/store/op-log.js";
import type { InsertVertexOp } from "../src/crdt/ops.js";

const tmpDirs: string[] = [];
function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "geomerge-test-"));
  tmpDirs.push(dir);
  return join(dir, "test.sqlite");
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const insertOp = (actor: string, clock: number, x: number, y: number, after: InsertVertexOp["after"] = null): InsertVertexOp => ({
  type: "insert",
  id: { actor, clock },
  after,
  position: [x, y],
});

describe("OpLogStore", () => {
  it("assigns increasing seq numbers within and across batches", () => {
    const log = new OpLogStore();
    log.createDocument("doc-1");
    const first = log.appendOps("doc-1", [insertOp("a", 1, 0, 0), insertOp("a", 2, 1, 0)]);
    const second = log.appendOps("doc-1", [insertOp("a", 3, 1, 1)]);
    expect(first).toEqual([1, 2]);
    expect(second).toEqual([3]);
    expect(log.latestSeq("doc-1")).toBe(3);
  });

  it("getOpsSince only returns ops after the given seq", () => {
    const log = new OpLogStore();
    log.createDocument("doc-1");
    log.appendOps("doc-1", [insertOp("a", 1, 0, 0), insertOp("a", 2, 1, 0)]);
    const since1 = log.getOpsSince("doc-1", 1);
    expect(since1.map((s) => s.seq)).toEqual([2]);
  });

  it("groups ops by push batch for replay", () => {
    const log = new OpLogStore();
    log.createDocument("doc-1");
    log.appendOps("doc-1", [insertOp("a", 1, 0, 0), insertOp("a", 2, 1, 0)]);
    log.appendOps("doc-1", [insertOp("b", 1, 2, 2)]);
    const batches = log.getBatches("doc-1");
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
  });

  it("rejects appending to a document that doesn't exist", () => {
    const log = new OpLogStore();
    expect(() => log.appendOps("nope", [insertOp("a", 1, 0, 0)])).toThrow();
  });

  it("rejects creating the same document twice", () => {
    const log = new OpLogStore();
    log.createDocument("doc-1");
    expect(() => log.createDocument("doc-1")).toThrow();
  });

  it("persists across a fresh store instance backed by the same file (simulated restart)", () => {
    const path = tmpDbPath();
    const first = new OpLogStore(path);
    first.createDocument("doc-1");
    first.appendOps("doc-1", [insertOp("a", 1, 0, 0), insertOp("a", 2, 1, 0)]);
    first.close();

    const reopened = new OpLogStore(path);
    expect(reopened.documentExists("doc-1")).toBe(true);
    expect(reopened.latestSeq("doc-1")).toBe(2);
    expect(reopened.getAllOps("doc-1")).toHaveLength(2);
    reopened.close();
  });
});
