import { idToString, type OpId } from "./ids.js";
import { LwwRegister } from "./lww.js";
import type { Point } from "../types.js";

/**
 * Holds every vertex's position register, independent of which polygon
 * ring(s) reference that vertex. Two `PolygonDocument`s constructed against
 * the *same* `VertexStore` and sharing a vertex id are sharing that vertex's
 * geometry — a move applied through either document's op stream is visible
 * to both. That's the literal "shared polygon edges" primitive: a parcel
 * boundary vertex two neighboring parcels both reference.
 */
export class VertexStore {
  private registers = new Map<string, LwwRegister<Point>>();

  create(id: OpId, position: Point): void {
    const key = idToString(id);
    if (this.registers.has(key)) {
      throw new Error(`VertexStore: vertex ${key} already exists`);
    }
    this.registers.set(key, new LwwRegister(position, id));
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
  }

  clone(): VertexStore {
    const copy = new VertexStore();
    for (const [key, register] of this.registers) {
      copy.registers.set(key, register.clone());
    }
    return copy;
  }
}
