/**
 * Trần upload ĐỒNG THỜI mỗi người (ADR-141, B M7): ≤ 3 — cái thứ 4 ⇒ 429 (SEC-CH-24). Trong bộ nhớ tiến
 * trình: v1 chạy MỘT instance (R47); lên ≥ 2 instance ⇒ chuyển sang Valkey cùng lúc với volume chung.
 */
export const MAX_CONCURRENT_UPLOADS = 3;

export class UploadSlots {
  readonly #inFlight = new Map<string, number>();

  constructor(private readonly max = MAX_CONCURRENT_UPLOADS) {}

  /** Giữ một lượt; hết lượt ⇒ `null`. Hàm trả về nhả lượt — idempotent. */
  tryAcquire(userId: string): (() => void) | null {
    const used = this.#inFlight.get(userId) ?? 0;
    if (used >= this.max) return null;
    this.#inFlight.set(userId, used + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.#inFlight.get(userId) ?? 1) - 1;
      if (left <= 0) this.#inFlight.delete(userId);
      else this.#inFlight.set(userId, left);
    };
  }

  inFlight(userId: string): number {
    return this.#inFlight.get(userId) ?? 0;
  }
}
