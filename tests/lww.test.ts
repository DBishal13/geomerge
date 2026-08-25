import { describe, expect, it } from "vitest";
import { LwwRegister } from "../src/crdt/lww.js";
import type { OpId } from "../src/crdt/ids.js";

const id = (actor: string, clock: number): OpId => ({ actor, clock });

describe("LwwRegister", () => {
  it("converges to the higher-clock write regardless of application order", () => {
    const forward = new LwwRegister<number>(0, id("base", 1));
    forward.set(1, id("A", 5));
    forward.set(2, id("B", 3));

    const backward = new LwwRegister<number>(0, id("base", 1));
    backward.set(2, id("B", 3));
    backward.set(1, id("A", 5));

    expect(forward.value).toBe(1);
    expect(backward.value).toBe(1);
  });

  it("breaks equal-clock ties by actor id, deterministically", () => {
    const a = new LwwRegister<string>("base", id("base", 1));
    a.set("from-a", id("actor-a", 2));
    a.set("from-b", id("actor-b", 2));

    const b = new LwwRegister<string>("base", id("base", 1));
    b.set("from-b", id("actor-b", 2));
    b.set("from-a", id("actor-a", 2));

    expect(a.value).toBe(b.value);
    expect(a.value).toBe("from-b"); // "actor-b" > "actor-a"
  });

  it("clone is independent of the original", () => {
    const original = new LwwRegister<number>(0, id("base", 1));
    const copy = original.clone();
    copy.set(99, id("A", 2));

    expect(original.value).toBe(0);
    expect(copy.value).toBe(99);
  });
});
