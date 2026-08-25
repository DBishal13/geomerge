import type { MergeResult, Point, Ring } from "./types.js";
import { findSelfIntersections } from "./topology.js";

function pointsEqual(p: Point, q: Point): boolean {
  return p[0] === q[0] && p[1] === q[1];
}

function assertSameLength(base: Ring, a: Ring, b: Ring): void {
  if (base.length !== a.length || base.length !== b.length) {
    throw new Error(
      `Geomerge MVP requires base/a/b to share the same vertex count (got ${base.length}/${a.length}/${b.length}). Insertions and deletions aren't supported yet.`,
    );
  }
}

/**
 * The bug this project exists to fix: plain last-writer-wins per vertex,
 * with zero awareness of the resulting shape. Kept around so the CLI and
 * tests can show the failure it produces side by side with `safeMerge`.
 */
export function naiveMerge(base: Ring, a: Ring, b: Ring): Ring {
  assertSameLength(base, a, b);
  return base.map((basePt, i) => {
    const aPt = a[i]!;
    const bPt = b[i]!;
    const changedA = !pointsEqual(basePt, aPt);
    const changedB = !pointsEqual(basePt, bPt);
    if (changedB) return bPt; // last writer (B) wins, no matter what it does to the shape
    if (changedA) return aPt;
    return basePt;
  });
}

/**
 * Topology-preserving merge. Per vertex: take whichever side changed it; if
 * both sides changed it to the same place, that's a non-conflict; if they
 * changed it to different places, that's a genuine conflict and we hold at
 * `base` until resolved. Then — regardless of whether any single vertex
 * conflicted — check whether the *combination* of edits produced a
 * self-intersecting ring, since two edits to two different vertices can
 * still cross each other. Any edited vertex touching a crossing edge gets
 * reverted to `base` and reported as a conflict, and we recheck. Reverting
 * everything always converges on `base`, which is valid by assumption, so
 * this is guaranteed to terminate in at most `base.length` passes.
 */
export function safeMerge(base: Ring, a: Ring, b: Ring): MergeResult {
  assertSameLength(base, a, b);

  const changed = base.map((basePt, i) => {
    const changedA = !pointsEqual(basePt, a[i]!);
    const changedB = !pointsEqual(basePt, b[i]!);
    return changedA || changedB;
  });

  const merged: Ring = base.map((basePt, i) => {
    const aPt = a[i]!;
    const bPt = b[i]!;
    const changedA = !pointsEqual(basePt, aPt);
    const changedB = !pointsEqual(basePt, bPt);
    if (changedA && changedB) return pointsEqual(aPt, bPt) ? aPt : basePt;
    if (changedA) return aPt;
    if (changedB) return bPt;
    return basePt;
  });

  const explicitConflicts = base
    .map((basePt, i) => {
      const changedA = !pointsEqual(basePt, a[i]!);
      const changedB = !pointsEqual(basePt, b[i]!);
      return changedA && changedB && !pointsEqual(a[i]!, b[i]!) ? i : -1;
    })
    .filter((i) => i >= 0);

  const reverted = new Set<number>(explicitConflicts);
  const applyReverts = (): Ring => merged.map((pt, i) => (reverted.has(i) ? base[i]! : pt));

  let ring = applyReverts();
  let crossings = findSelfIntersections(ring);

  let guard = base.length;
  while (crossings.length > 0 && guard-- > 0) {
    let progressed = false;
    for (const { edgeI, edgeJ } of crossings) {
      for (const idx of [edgeI, (edgeI + 1) % ring.length, edgeJ, (edgeJ + 1) % ring.length]) {
        if (changed[idx] && !reverted.has(idx)) {
          reverted.add(idx);
          progressed = true;
        }
      }
    }
    if (!progressed) break; // remaining crossing pre-dates our edits (base itself isn't simple)
    ring = applyReverts();
    crossings = findSelfIntersections(ring);
  }

  return {
    polygon: ring,
    conflicts: Array.from(reverted).sort((x, y) => x - y),
    valid: crossings.length === 0,
  };
}
