import type { OpId } from "./ids.js";
import type { Point } from "../types.js";

/** A vertex's identity is the id of the op that created it. */
export type VertexId = OpId;

export interface InsertVertexOp {
  type: "insert";
  id: OpId;
  /** Ring position: insert immediately after this vertex, or at the head if null. */
  after: VertexId | null;
  position: Point;
}

export interface MoveVertexOp {
  type: "move";
  id: OpId;
  vertex: VertexId;
  position: Point;
}

export interface DeleteVertexOp {
  type: "delete";
  id: OpId;
  vertex: VertexId;
}

export type PolygonOp = InsertVertexOp | MoveVertexOp | DeleteVertexOp;
