import { describe, expect, it } from "vitest";
import { naiveMerge, safeMerge } from "../src/merge.js";
import { isSimplePolygon } from "../src/topology.js";
import { base, crewA, crewB } from "../src/demo.js";
import type { Ring } from "../src/types.js";

describe("naiveMerge", () => {
  it("silently produces a self-intersecting polygon on the notch scenario", () => {
    const merged = naiveMerge(base, crewA, crewB);
    expect(isSimplePolygon(merged)).toBe(false);
  });

  it("takes b's edit over a's on a genuine per-vertex conflict, with no validity check", () => {
    const a: Ring = base.map((p, i): [number, number] => (i === 0 ? [1, 1] : p));
    const b: Ring = base.map((p, i): [number, number] => (i === 0 ? [2, 2] : p));
    expect(naiveMerge(base, a, b)[0]).toEqual([2, 2]);
  });
});

describe("safeMerge", () => {
  it("always returns a simple polygon on the notch scenario", () => {
    const result = safeMerge(base, crewA, crewB);
    expect(result.valid).toBe(true);
    expect(isSimplePolygon(result.polygon)).toBe(true);
  });

  it("reverts exactly the vertices whose combined edit caused the crossing", () => {
    const result = safeMerge(base, crewA, crewB);
    expect(result.conflicts).toEqual([3, 4]);
    expect(result.polygon[3]).toEqual(base[3]);
    expect(result.polygon[4]).toEqual(base[4]);
  });

  it("applies non-conflicting edits from both sides untouched", () => {
    const a: Ring = base.map((p, i): [number, number] => (i === 1 ? [10, 1] : p));
    const b: Ring = base.map((p, i): [number, number] => (i === 5 ? [1, 10] : p));
    const result = safeMerge(base, a, b);
    expect(result.valid).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.polygon[1]).toEqual([10, 1]);
    expect(result.polygon[5]).toEqual([1, 10]);
  });

  it("flags a genuine per-vertex conflict and falls back to base instead of guessing", () => {
    const a: Ring = base.map((p, i): [number, number] => (i === 0 ? [1, 1] : p));
    const b: Ring = base.map((p, i): [number, number] => (i === 0 ? [2, 2] : p));
    const result = safeMerge(base, a, b);
    expect(result.conflicts).toEqual([0]);
    expect(result.polygon[0]).toEqual(base[0]);
    expect(result.valid).toBe(true);
  });

  it("treats identical concurrent edits as a converged, conflict-free change", () => {
    const a: Ring = base.map((p, i): [number, number] => (i === 0 ? [1, 1] : p));
    const b: Ring = base.map((p, i): [number, number] => (i === 0 ? [1, 1] : p));
    const result = safeMerge(base, a, b);
    expect(result.conflicts).toEqual([]);
    expect(result.polygon[0]).toEqual([1, 1]);
  });

  it("throws when base/a/b vertex counts disagree", () => {
    const shorter = base.slice(1);
    expect(() => safeMerge(base, shorter, base)).toThrow();
  });
});
