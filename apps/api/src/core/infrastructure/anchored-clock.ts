import type { IClock } from '../domain';

/**
 * Đồng hồ nghiệp vụ tất định cho E2E (`TEST_CLOCK_ANCHOR`, CHỈ APP_ENV=test — env.ts chặn nơi khác): NEO + TRÔI,
 * không đóng băng — `now = anchor + (base.now() − lúc tạo)`. Giờ vẫn chạy (lọc OUT sau IN theo ms, replay
 * idempotency, keyset `(createdAt, id)`, đồng hồ thẻ chạy từng giây) nhưng ngày / giờ trong ngày cố định theo mốc,
 * nên E2E không đổi kết quả theo lúc CI chạy (sau 17:30, Chủ nhật, nửa đêm, cuối tháng).
 * Chỉ nối vào module nghiệp vụ (composition root); auth/JWT, rate limit, socket vẫn dùng giờ thật.
 */
export class AnchoredClock implements IClock {
  readonly #anchorMs: number;
  readonly #startedMs: number;

  constructor(
    anchor: Date,
    private readonly base: IClock,
  ) {
    this.#anchorMs = anchor.getTime();
    this.#startedMs = base.now().getTime();
  }

  now(): Date {
    return new Date(this.#anchorMs + (this.base.now().getTime() - this.#startedMs));
  }
}
