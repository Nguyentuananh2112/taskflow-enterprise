import type { IClock } from '../../../../core/domain';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { IRefreshTokenPurger } from '../ports/refresh-token-purger.port';

/**
 * security.md §2.2: giữ refresh token tới 7 ngày sau khi CẢ PHIÊN (family) hết hạn tuyệt đối, rồi
 * xóa — bảng có `ip` / `user_agent` (dữ liệu cá nhân) không được tăng mãi (G2 S2).
 * Vì sao theo `familyExpiresAt` chứ không theo `expiresAt` của từng token: token đã xoay vẫn phát hiện
 * reuse (`assess` ⇒ 'reused' ⇒ thu hồi family) kể cả khi đã hết hạn — xóa sớm theo `expiresAt` làm
 * mất phát hiện trộm token trong lúc family còn sống (tới 30 ngày). Sau hạn tuyệt đối thì cả family
 * vô dụng; nạp lại cache thu hồi (X3) chỉ cần các phiên thu hồi trong vòng TTL access token.
 */
export const REFRESH_TOKEN_RETENTION_AFTER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
/** Số dòng mỗi transaction — transaction ngắn, không giữ khóa lâu. */
export const REFRESH_TOKEN_PURGE_BATCH = 5_000;
/** Trần số lô mỗi lượt (≤ 100k dòng/lượt) — phần còn lại để lượt sau. */
export const REFRESH_TOKEN_PURGE_MAX_BATCHES = 20;

export interface RefreshTokenPurgeResult {
  deleted: number;
  batches: number;
  /** Instance khác đang chạy lô ⇒ dừng lượt này. */
  busy: boolean;
  /** Đã xóa hết dòng quá hạn (lô cuối ít hơn `batchSize`). */
  complete: boolean;
}

/**
 * Job dọn refresh token (G2 S2, cùng mẫu với purge workspace — ADR-095): mỗi lô một transaction,
 * khóa advisory của lô do purger lấy; `signal` hủy (graceful shutdown) ⇒ dừng TRƯỚC lô kế tiếp.
 * Idempotent: chạy lại bất kỳ lúc nào là an toàn.
 */
export class PurgeExpiredRefreshTokensJob {
  constructor(
    private readonly d: { purger: IRefreshTokenPurger; uow: IUnitOfWork; clock: IClock },
  ) {}

  async execute(
    input: { batchSize?: number; maxBatches?: number; signal?: AbortSignal } = {},
  ): Promise<RefreshTokenPurgeResult> {
    const batchSize = input.batchSize ?? REFRESH_TOKEN_PURGE_BATCH;
    const maxBatches = input.maxBatches ?? REFRESH_TOKEN_PURGE_MAX_BATCHES;
    const cutoff = new Date(this.d.clock.now().getTime() - REFRESH_TOKEN_RETENTION_AFTER_EXPIRY_MS);
    const result: RefreshTokenPurgeResult = {
      deleted: 0,
      batches: 0,
      busy: false,
      complete: false,
    };
    while (result.batches < maxBatches && !input.signal?.aborted) {
      const deleted = await this.d.uow.run(() => this.d.purger.purgeExpired(cutoff, batchSize));
      if (deleted === null) {
        result.busy = true;
        break;
      }
      result.deleted += deleted;
      result.batches += 1;
      if (deleted < batchSize) {
        result.complete = true;
        break;
      }
    }
    return result;
  }
}
