/**
 * Trần upload ĐỒNG THỜI (ADR-141, B M7): ≤ 3 mỗi người — cái thứ 4 ⇒ 429 (SEC-CH-24) — và ≤ 12 trên cả
 * tiến trình (B L3: N người × 3 × 20 MB cùng ghi đĩa). Trong bộ nhớ tiến trình: v1 chạy MỘT instance (R47);
 * lên ≥ 2 instance ⇒ chuyển sang Valkey cùng lúc với volume chung.
 */
export const MAX_CONCURRENT_UPLOADS = 3;
export const MAX_CONCURRENT_UPLOADS_TOTAL = 12;

export class UploadSlots {
  readonly #inFlight = new Map<string, number>();
  #total = 0;

  constructor(
    private readonly maxPerUser = MAX_CONCURRENT_UPLOADS,
    private readonly maxTotal = MAX_CONCURRENT_UPLOADS_TOTAL,
  ) {}

  /** Giữ một lượt; hết lượt (của người hoặc của tiến trình) ⇒ `null`. Hàm trả về nhả lượt — idempotent. */
  tryAcquire(userId: string): (() => void) | null {
    const used = this.#inFlight.get(userId) ?? 0;
    if (used >= this.maxPerUser || this.#total >= this.maxTotal) return null;
    this.#inFlight.set(userId, used + 1);
    this.#total += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#total -= 1;
      const left = (this.#inFlight.get(userId) ?? 1) - 1;
      if (left <= 0) this.#inFlight.delete(userId);
      else this.#inFlight.set(userId, left);
    };
  }

  inFlight(userId: string): number {
    return this.#inFlight.get(userId) ?? 0;
  }

  get total(): number {
    return this.#total;
  }
}
