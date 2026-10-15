import type { IRefreshTokenPurger } from '../../../application/ports/refresh-token-purger.port';
import type { DbProvider } from './db';

/** Khóa advisory của "một lô dọn refresh token" — hằng số chung mọi instance (mẫu ADR-095). */
export const REFRESH_TOKEN_PURGE_LOCK_KEY = 'taskflow:refresh-token-purge';

/**
 * G2 S2. Câu ĐẦU TIÊN của transaction lô là `pg_try_advisory_xact_lock(<hằng số>)` — tự nhả khi
 * commit/rollback, an toàn với pool. Không lấy được ⇒ `null` (instance khác đang chạy).
 * Điều kiện là `family_expires_at < cutoff`; thêm `expires_at < cutoff` (luôn đúng khi điều kiện kia
 * đúng, vì `expires_at ≤ family_expires_at`) để dùng index `expires_at`. Cũ nhất trước; `SKIP LOCKED`
 * ⇒ không chờ dòng đang bị khóa
 * (vd `revokeFamily` của logout-all đang cập nhật) — lô sau xóa nốt.
 * Xóa dòng làm `replaced_by_id` của dòng khác thành NULL (FK `ON DELETE SET NULL`) — dòng đó cũ
 * hơn, cũng đã hết hạn hoặc sắp bị xóa.
 */
export class PrismaRefreshTokenPurger implements IRefreshTokenPurger {
  constructor(private readonly db: DbProvider) {}

  async purgeExpired(cutoff: Date, limit: number): Promise<number | null> {
    const [row] = await this.db().$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${REFRESH_TOKEN_PURGE_LOCK_KEY}, 0)) AS locked`;
    if (!row?.locked) return null;
    return this.db().$executeRaw`
      DELETE FROM refresh_tokens WHERE id IN (
        SELECT id FROM refresh_tokens
         WHERE expires_at < ${cutoff} AND family_expires_at < ${cutoff}
         ORDER BY expires_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }
}
