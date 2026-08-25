import { describe, expect, it } from "vitest";
import { RgaList } from "../src/crdt/rga.js";
import type { OpId } from "../src/crdt/ids.js";

const id = (actor: string, clock: number): OpId => ({ actor, clock });

describe("RgaList", () => {
  it("orders a sequential chain by insertion", () => {
    const list = new RgaList<string>();
    const base = id("base", 1);
    list.insertAfter(base, null, "base");
    list.insertAfter(id("base", 2), base, "second");
    expect(list.toArray()).toEqual(["base", "second"]);
  });

  it("converges regardless of which order concurrent siblings are applied in", () => {
    const origin = id("base", 1);
    const insertX = id("A", 5);
    const insertY = id("B", 3);

    const forward = new RgaList<string>();
    forward.insertAfter(origin, null, "base");
    forward.insertAfter(insertX, origin, "x");
    forward.insertAfter(insertY, origin, "y");

    const backward = new RgaList<string>();
    backward.insertAfter(origin, null, "base");
    backward.insertAfter(insertY, origin, "y");
    backward.insertAfter(insertX, origin, "x");

    expect(forward.toArray()).toEqual(backward.toArray());
  });

  it("converges for three concurrent siblings in any application order", () => {
    const origin = id("base", 1);
    const inserts: [OpId, string][] = [
      [id("A", 5), "x"],
      [id("B", 3), "y"],
      [id("C", 9), "z"],
    ];

    const build = (order: number[]): string[] => {
      const list = new RgaList<string>();
      list.insertAfter(origin, null, "base");
      for (const i of order) {
        const [opId, value] = inserts[i]!;
        list.insertAfter(opId, origin, value);
      }
      return list.toArray();
    };

    const reference = build([0, 1, 2]);
    expect(build([2, 1, 0])).toEqual(reference);
    expect(build([1, 2, 0])).toEqual(reference);
    expect(build([2, 0, 1])).toEqual(reference);
  });

  it("keeps tombstones so a later insert can still anchor on a deleted vertex", () => {
    const list = new RgaList<string>();
    const base = id("base", 1);
    const doomed = id("base", 2);
    list.insertAfter(base, null, "base");
    list.insertAfter(doomed, base, "doomed");
    list.remove(doomed);

    expect(list.toArray()).toEqual(["base"]);
    expect(() => list.insertAfter(id("A", 3), doomed, "after-doomed")).not.toThrow();
    expect(list.toArray()).toEqual(["base", "after-doomed"]);
  });

  it("clone is independent of the original", () => {
    const list = new RgaList<string>();
    const base = id("base", 1);
    list.insertAfter(base, null, "base");

    const copy = list.clone();
    copy.insertAfter(id("A", 2), base, "only-on-copy");

    expect(list.toArray()).toEqual(["base"]);
    expect(copy.toArray()).toEqual(["base", "only-on-copy"]);
  });
});
