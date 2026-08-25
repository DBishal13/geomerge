export type Point = [number, number];

/**
 * An open ring: vertices in order, first point NOT repeated at the end.
 * Vertex `i` in `base`, `a`, and `b` are assumed to be the same logical
 * vertex (stable identity by index) — this MVP does not yet handle
 * inserted/deleted vertices, only concurrent moves of existing ones.
 */
export type Ring = Point[];

export interface MergeResult {
  polygon: Ring;
  /** Indices of vertices Geomerge could not auto-resolve and fell back to `base` for. */
  conflicts: number[];
  valid: boolean;
}
