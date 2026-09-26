import { compareId, idToString, type OpId } from "./ids.js";
import { LwwRegister } from "./lww.js";
import type { Point } from "../types.js";

/**
 * Holds every vertex's position register, independent of which polygon
 * ring(s) reference that vertex. Two `PolygonDocument`s constructed against
 * the *same* `VertexStore` and sharing a vertex id are sharing that vertex's
 * geometry — a move applied through either document's op stream is visible
 * to both. That's the literal "shared polygon edges" primitive: a parcel
 * boundary vertex two neighboring parcels both reference.
 *
 * Besides the LWW winner, it keeps every write a vertex has received (its
 * creation plus each move, deduped by op id). `PolygonDocument.materialize()`
 * replays those writes in id order to decide which moves it can accept, so it
 * needs the whole history, not just the latest value.
 */
export interface VertexWrite {
  id: OpId;
  position: Point;
}

export class VertexStore {
  private registers = new Map<string, LwwRegister<Point>>();
  private writes = new Map<string, VertexWrite[]>();

  create(id: OpId, position: Point): void {
    const key = idToString(id);
    if (this.registers.has(key)) {
      throw new Error(`VertexStore: vertex ${key} already exists`);
    }
    this.registers.set(key, new LwwRegister(position, id));
    this.writes.set(key, [{ id, position }]);
  }

  get(id: OpId): LwwRegister<Point> | undefined {
    return this.registers.get(idToString(id));
  }

  move(vertex: OpId, position: Point, opId: OpId): void {
    const register = this.get(vertex);
    if (!register) {
      throw new Error(`VertexStore: unknown vertex ${idToString(vertex)}`);
    }
    register.set(position, opId);
    const writes = this.writes.get(idToString(vertex))!;
    if (!writes.some((w) => compareId(w.id, opId) === 0)) writes.push({ id: opId, position });
  }

  /** Every write this vertex has received: its creation first, then moves in arrival order. */
  history(id: OpId): readonly VertexWrite[] {
    return this.writes.get(idToString(id)) ?? [];
  }

  clone(): VertexStore {
    const copy = new VertexStore();
    for (const [key, register] of this.registers) {
      copy.registers.set(key, register.clone());
    }
    for (const [key, writes] of this.writes) {
      copy.writes.set(key, [...writes]);
    }
    return copy;
  }
}
