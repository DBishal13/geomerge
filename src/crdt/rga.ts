import { compareId, idEquals, type OpId } from "./ids.js";

interface RgaNode<T> {
  id: OpId;
  origin: OpId | null;
  value: T;
  tombstone: boolean;
}

/**
 * A Replicated Growable Array: an ordered list CRDT. `insertAfter` and
 * `remove` commute — applying the same set of ops in any order (as long as
 * each insert is applied after the op that created its `origin`, which the
 * causal delivery in `PolygonDocument` guarantees) converges to the same
 * sequence on every replica. Deletes are tombstones, not removals, so a
 * concurrent insert anchored on a deleted element still has something to
 * anchor to.
 *
 * Tie-break for concurrent inserts sharing the same `origin`: highest
 * `compareId` wins the position closest to `origin`. This is the standard
 * RGA rule and is proven correct for siblings of a single origin; it does
 * not attempt the deeper subtree-ordering some list CRDTs (e.g. Fugue) add
 * for interleaving-free concurrent inserts several levels deep — fine for
 * this MVP's "one or two crews editing one boundary" scenarios, worth
 * revisiting if editing becomes many-actor and highly concurrent.
 */
export class RgaList<T> {
  private nodes: RgaNode<T>[] = [];

  insertAfter(id: OpId, origin: OpId | null, value: T): void {
    let index: number;
    if (origin === null) {
      index = 0;
    } else {
      const originIndex = this.nodes.findIndex((n) => idEquals(n.id, origin));
      if (originIndex === -1) {
        throw new Error(`RgaList: unknown origin ${origin.actor}:${origin.clock}`);
      }
      index = originIndex + 1;
    }

    while (index < this.nodes.length) {
      const candidate = this.nodes[index]!;
      const sameOrigin = candidate.origin === null ? origin === null : origin !== null && idEquals(candidate.origin, origin);
      if (sameOrigin && compareId(candidate.id, id) > 0) {
        index += 1;
      } else {
        break;
      }
    }

    this.nodes.splice(index, 0, { id, origin, value, tombstone: false });
  }

  remove(id: OpId): void {
    const node = this.nodes.find((n) => idEquals(n.id, id));
    if (node) node.tombstone = true;
  }

  has(id: OpId): boolean {
    return this.nodes.some((n) => idEquals(n.id, id));
  }

  /** Live (non-tombstoned) values in current sequence order. */
  toArray(): T[] {
    return this.nodes.filter((n) => !n.tombstone).map((n) => n.value);
  }

  /** Live entries paired with their stable ids, for callers that need to map values back to ids. */
  entries(): { id: OpId; value: T }[] {
    return this.nodes.filter((n) => !n.tombstone).map((n) => ({ id: n.id, value: n.value }));
  }

  /** Every entry ever inserted, tombstoned or not, in sequence order. */
  allEntries(): { id: OpId; value: T; tombstone: boolean }[] {
    return this.nodes.map((n) => ({ id: n.id, value: n.value, tombstone: n.tombstone }));
  }

  clone(): RgaList<T> {
    const copy = new RgaList<T>();
    copy.nodes = this.nodes.map((n) => ({ ...n }));
    return copy;
  }
}
