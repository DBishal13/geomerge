import { compareId, type OpId } from "./ids.js";

/**
 * Last-writer-wins register. Converges regardless of the order concurrent
 * `set` calls are applied in, because the winner is decided by `compareId`
 * (Lamport clock, actor id tiebreak) rather than arrival order.
 */
export class LwwRegister<T> {
  private id: OpId;
  private currentValue: T;

  constructor(initialValue: T, initialId: OpId) {
    this.currentValue = initialValue;
    this.id = initialId;
  }

  get value(): T {
    return this.currentValue;
  }

  get writeId(): OpId {
    return this.id;
  }

  set(value: T, id: OpId): void {
    if (compareId(id, this.id) > 0) {
      this.id = id;
      this.currentValue = value;
    }
  }

  clone(): LwwRegister<T> {
    return new LwwRegister(this.currentValue, this.id);
  }
}
