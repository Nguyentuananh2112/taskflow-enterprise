import type { IClock } from '../domain';
import { RateLimitedError, ServiceUnavailableError } from '../errors';

/** Bộ đếm cộng dồn có hạn (Valkey `INCRBY` + `EXPIRE`; bộ nhớ ở local/test). */
export interface ByteCounter {
  incrBy(key: string, by: number, ttlSec: number): Promise<number>;
}

/** Client tối thiểu của node-redis cho bộ đếm. */
export interface ValkeyIncrClient {
  incrBy(key: string, by: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export function valkeyByteCounter(client: ValkeyIncrClient): ByteCounter {
  return {
    async incrBy(key, by, ttlSec) {
      const total = await client.incrBy(key, by);
      if (total === by) await client.expire(key, ttlSec); // lần đầu trong ngày
      return total;
    },
  };
}

/** Một tiến trình (v1 — R47); khóa ngày cũ tự rơi khi đổi ngày (không dọn — vài chục khóa / ngày). */
export class MemoryByteCounter implements ByteCounter {
  readonly #totals = new Map<string, number>();
  incrBy(key: string, by: number): Promise<number> {
    const total = (this.#totals.get(key) ?? 0) + by;
    this.#totals.set(key, total);
    return Promise.resolve(total);
  }
}

const DAY_MS = 86_400_000;
/** Ngày theo giờ Việt Nam (UTC+7, không DST) — "mỗi ngày" của người dùng. */
const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * Trần byte upload mỗi người mỗi ngày (ADR-141: 200 MB; `CHAT_UPLOAD_DAILY_BYTES` ở test). Đếm SAU khi biết kích
 * thước (bản tạm), TRƯỚC khi xử lý / ghi kho; vượt ⇒ trả lại phần vừa cộng + 429. Kho đếm lỗi ⇒ 503 (fail-closed —
 * upload tốn đĩa, khác R21).
 */
export class UploadByteBudget {
  constructor(
    private readonly counter: ByteCounter,
    private readonly limitBytes: number,
    private readonly clock: IClock,
  ) {}

  async consume(userId: string, bytes: number): Promise<void> {
    const local = this.clock.now().getTime() + VN_OFFSET_MS;
    const day = new Date(local).toISOString().slice(0, 10);
    const key = `ub:${userId}:${day}`;
    let total: number;
    try {
      total = await this.counter.incrBy(key, bytes, 2 * 86_400);
    } catch {
      throw new ServiceUnavailableError();
    }
    if (total <= this.limitBytes) return;
    await this.counter.incrBy(key, -bytes, 2 * 86_400).catch(() => undefined);
    const retryAfterSec = Math.max(1, Math.ceil((DAY_MS - (local % DAY_MS)) / 1000));
    throw new RateLimitedError(retryAfterSec, 'Đã vượt dung lượng tải lên trong ngày.');
  }
}
