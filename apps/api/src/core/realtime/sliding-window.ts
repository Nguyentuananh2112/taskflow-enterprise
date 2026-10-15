/**
 * Đếm cửa sổ trượt trong bộ nhớ theo key — cho giới hạn gắn với kết nối / instance (không cần
 * chia sẻ qua Valkey). Key không còn lần đếm nào trong cửa sổ được dọn định kỳ (mỗi `windowMs`).
 */
export class SlidingWindow {
  readonly #hits = new Map<string, number[]>();
  #lastSweep = Number.NEGATIVE_INFINITY;

  constructor(private readonly rule: { readonly windowMs: number; readonly limit: number }) {}

  /** Ghi một lần nếu còn hạn mức; hết ⇒ `false` (không ghi). */
  tryHit(key: string, now: number): boolean {
    this.#sweep(now);
    const since = now - this.rule.windowMs;
    const hits = (this.#hits.get(key) ?? []).filter((t) => t > since);
    const allowed = hits.length < this.rule.limit;
    if (allowed) hits.push(now);
    if (hits.length) this.#hits.set(key, hits);
    else this.#hits.delete(key);
    return allowed;
  }

  /** Số key đang được theo dõi (để test kiểm việc dọn). */
  get size(): number {
    return this.#hits.size;
  }

  #sweep(now: number): void {
    if (now - this.#lastSweep < this.rule.windowMs) return;
    this.#lastSweep = now;
    const since = now - this.rule.windowMs;
    for (const [key, hits] of this.#hits) {
      if ((hits[hits.length - 1] ?? Number.NEGATIVE_INFINITY) <= since) this.#hits.delete(key);
    }
  }
}
