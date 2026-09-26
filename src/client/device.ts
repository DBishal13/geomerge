import { LamportClock, idToString } from "../crdt/ids.js";
import { PolygonDocument, type DocumentMergeResult } from "../crdt/document.js";
import { VertexStore } from "../crdt/vertex-store.js";
import type { PolygonOp } from "../crdt/ops.js";

/**
 * A reference client for the actual offline-sync loop: hold a local
 * `PolygonDocument` replica, edit it while offline (no network calls at
 * all), then reconcile with the server by pushing local ops and pulling
 * anything missed — in either order, since the CRDT is what guarantees
 * convergence, not synchronization order.
 *
 * Two correctness traps this class exists to avoid, both real bugs found
 * while building it:
 *
 * 1. `lastSeenSeq` only ever advances from a *pull* response, never from a
 *    push response. A push tells you where *your own* ops landed in the
 *    log, not whether another device's ops landed in the gap before them —
 *    trusting it to mean "I'm caught up through here" silently strands the
 *    device behind ops it never actually fetched.
 * 2. Every op is applied through `applyOnce`, deduped by id. A pull after
 *    a push will re-fetch the device's own already-applied ops (since the
 *    watermark above only advances on pulls) — reapplying a `move` is
 *    harmless (LWW is idempotent), but reapplying an `insert` is not: the
 *    RGA has no duplicate-id guard and would splice the same vertex into
 *    the ring twice.
 */
export class GeomergeDevice {
  readonly clock: LamportClock;
  readonly document: PolygonDocument;
  private lastSeenSeq = 0;
  private appliedOpIds = new Set<string>();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly documentId: string,
    actor: string,
    store: VertexStore = new VertexStore(),
  ) {
    this.clock = new LamportClock(actor);
    this.document = new PolygonDocument(store);
  }

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` };
  }

  private applyOnce(op: PolygonOp): boolean {
    const key = idToString(op.id);
    if (this.appliedOpIds.has(key)) return false;
    this.document.apply(op);
    this.appliedOpIds.add(key);
    return true;
  }

  /** Fetches every op since this device last synced, applying whatever it hasn't already seen. */
  async syncPull(): Promise<PolygonOp[]> {
    const res = await fetch(`${this.baseUrl}/v1/documents/${this.documentId}/ops?since=${this.lastSeenSeq}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`syncPull failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { ops: { seq: number; op: PolygonOp }[] };

    const newlyApplied: PolygonOp[] = [];
    for (const { seq, op } of body.ops) {
      if (this.applyOnce(op)) {
        this.clock.observe(op.id);
        newlyApplied.push(op);
      }
      this.lastSeenSeq = Math.max(this.lastSeenSeq, seq);
    }
    return newlyApplied;
  }

  /** Applies ops locally (offline-safe — no network). */
  editLocally(ops: PolygonOp[]): void {
    for (const op of ops) this.applyOnce(op);
  }

  /** Sends ops to the server. They should already be applied locally (via `editLocally`) first. */
  async syncPush(ops: PolygonOp[]): Promise<void> {
    for (const op of ops) this.applyOnce(op); // in case a caller pushes without editing locally first
    const res = await fetch(`${this.baseUrl}/v1/documents/${this.documentId}/ops`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ ops }),
    });
    if (!res.ok) throw new Error(`syncPush failed: ${res.status} ${await res.text()}`);
    // Deliberately not touching lastSeenSeq here — see class docstring.
  }

  localState(): DocumentMergeResult {
    return this.document.materialize();
  }
}
