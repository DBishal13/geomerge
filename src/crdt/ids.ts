/** A Lamport-clock-stamped id: unique per op, totally ordered across actors. */
export interface OpId {
  actor: string;
  clock: number;
}

export function idEquals(a: OpId, b: OpId): boolean {
  return a.actor === b.actor && a.clock === b.clock;
}

/** Total order over ids: higher clock wins; actor id breaks exact ties. */
export function compareId(a: OpId, b: OpId): number {
  if (a.clock !== b.clock) return a.clock - b.clock;
  return a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0;
}

export function idToString(id: OpId): string {
  return `${id.actor}:${id.clock}`;
}

/**
 * Per-actor Lamport clock. `tick()` stamps a new local op; `observe()` folds
 * in a remote op's clock so future local ids stay causally ahead of
 * anything this actor has seen.
 */
export class LamportClock {
  private counter = 0;

  constructor(private readonly actor: string) {}

  tick(): OpId {
    this.counter += 1;
    return { actor: this.actor, clock: this.counter };
  }

  observe(remote: OpId): void {
    this.counter = Math.max(this.counter, remote.clock);
  }
}
