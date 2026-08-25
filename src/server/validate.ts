import { badRequest } from "./errors.js";
import type { OpId } from "../crdt/ids.js";
import type { PolygonOp } from "../crdt/ops.js";
import type { Point } from "../types.js";

function isOpId(value: unknown): value is OpId {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OpId).actor === "string" &&
    typeof (value as OpId).clock === "number"
  );
}

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** Validates an untrusted JSON value is a well-formed PolygonOp. Throws 400 with a specific reason otherwise. */
export function validatePolygonOp(raw: unknown): PolygonOp {
  if (typeof raw !== "object" || raw === null) {
    throw badRequest("op must be an object");
  }
  const op = raw as Record<string, unknown>;

  if (!isOpId(op.id)) {
    throw badRequest("op.id must be { actor: string, clock: number }");
  }

  switch (op.type) {
    case "insert":
      if (op.after !== null && !isOpId(op.after)) {
        throw badRequest("insert op.after must be null or an OpId");
      }
      if (!isPoint(op.position)) {
        throw badRequest("insert op.position must be a [number, number] point");
      }
      return { type: "insert", id: op.id, after: op.after as OpId | null, position: op.position };

    case "move":
      if (!isOpId(op.vertex)) {
        throw badRequest("move op.vertex must be an OpId");
      }
      if (!isPoint(op.position)) {
        throw badRequest("move op.position must be a [number, number] point");
      }
      return { type: "move", id: op.id, vertex: op.vertex, position: op.position };

    case "delete":
      if (!isOpId(op.vertex)) {
        throw badRequest("delete op.vertex must be an OpId");
      }
      return { type: "delete", id: op.id, vertex: op.vertex };

    default:
      throw badRequest(`op.type must be "insert", "move", or "delete" (got ${JSON.stringify(op.type)})`);
  }
}

export function validatePolygonOps(raw: unknown): PolygonOp[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest("ops must be a non-empty array");
  }
  return raw.map(validatePolygonOp);
}
