import { RateLimitedError } from '../errors';

/** Số export .xlsx / CSV được chạy ĐỒNG THỜI trong công ty (SEC-HR-54 — export thứ 3 ⇒ 429). */
export const MAX_CONCURRENT_EXPORTS = 2;

/**
 * Suất chạy export đồng thời của CÔNG TY (một công ty — ADR-133; B review T-057). Lấy suất TRƯỚC khi đếm / audit:
 * hết suất ⇒ 429 `RATE_LIMITED` (không audit). Bên gọi PHẢI nhả trong `finally` — kể cả khi client hủy giữa chừng.
 *
 * Đếm trong bộ nhớ của process: v1 chạy 1 instance API (devops.md). Chạy > 1 instance thì trần thực tế = 2 × N —
 * chuyển sang bộ đếm Valkey như hạn mức realtime (R24) khi đó.
 */
export class ExportSlots {
  #running = 0;

  constructor(private readonly max = MAX_CONCURRENT_EXPORTS) {}

  /** Trả hàm nhả suất (gọi nhiều lần vẫn chỉ nhả một). */
  acquire(): () => void {
    if (this.#running >= this.max) {
      throw new RateLimitedError(
        30,
        'Đang có báo cáo khác được xuất — vui lòng thử lại sau ít phút.',
      );
    }
    this.#running += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#running -= 1;
    };
  }

  get running(): number {
    return this.#running;
  }
}
