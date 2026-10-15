/**
 * Tập có giới hạn: vượt `capacity` thì bỏ phần tử cũ nhất. Dùng khử trùng lặp `eventId` của
 * realtime (data-and-api §4.4-2: giữ ~500 id gần nhất). `Set` giữ thứ tự chèn ⇒ phần tử đầu là cũ nhất.
 */
export class LruSet<T> {
  private readonly items = new Set<T>();

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error('LruSet cần capacity ≥ 1');
  }

  has(value: T): boolean {
    return this.items.has(value);
  }

  add(value: T): void {
    this.items.delete(value);
    this.items.add(value);
    if (this.items.size > this.capacity) {
      const oldest = this.items.values().next().value as T;
      this.items.delete(oldest);
    }
  }

  get size(): number {
    return this.items.size;
  }
}
