/**
 * Event scheduler: the deterministic time-ordered worklist.
 *
 * Entries are ordered by (time, order). Ties break on insertion order,
 * so identical scripts always produce identical schedules.
 */

export interface ScheduledItem<T> {
  readonly time: number;
  readonly order: number;
  readonly value: T;
}

export class Scheduler<T> {
  private items: ScheduledItem<T>[] = [];
  private nextOrder = 0;

  schedule(time: number, value: T): void {
    this.items.push({ time, order: this.nextOrder++, value });
    this.items.sort((a, b) => a.time - b.time || a.order - b.order);
  }

  peek(): ScheduledItem<T> | undefined {
    return this.items[0];
  }

  pop(): ScheduledItem<T> | undefined {
    return this.items.shift();
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
    this.nextOrder = 0;
  }
}
