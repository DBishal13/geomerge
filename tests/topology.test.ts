import { describe, expect, it } from "vitest";
import { findSelfIntersections, isSimplePolygon } from "../src/topology.js";
import type { Ring } from "../src/types.js";

describe("findSelfIntersections", () => {
  it("finds no crossings in a simple square", () => {
    const square: Ring = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(findSelfIntersections(square)).toEqual([]);
    expect(isSimplePolygon(square)).toBe(true);
  });

  it("does not flag adjacent edges as crossing at their shared vertex", () => {
    const triangle: Ring = [
      [0, 0],
      [10, 0],
      [5, 10],
    ];
    expect(findSelfIntersections(triangle)).toEqual([]);
  });

  it("detects a bowtie self-intersection", () => {
    const bowtie: Ring = [
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 10],
    ];
    const crossings = findSelfIntersections(bowtie);
    expect(crossings.length).toBeGreaterThan(0);
    expect(isSimplePolygon(bowtie)).toBe(false);
  });
});
