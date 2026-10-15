import type { RefreshToken, RefreshTokenRevokeReason } from '../../domain/refresh-token';

export interface IRefreshTokenRepository {
  add(token: RefreshToken): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshToken | null>;
  /**
   * `UPDATE … SET revoked_at, revoked_reason='ROTATED', replaced_by_id WHERE id = ? AND revoked_at
   * IS NULL`. Trả `false` khi đã bị thu hồi trước đó (thua race với request khác — REF-06).
   */
  markRotated(id: string, successorId: string, at: Date): Promise<boolean>;
  /** Thu hồi mọi token **chưa thu hồi** của family; trả số dòng đổi. */
  revokeFamily(familyId: string, reason: RefreshTokenRevokeReason, at: Date): Promise<number>;
  /** Thu hồi mọi token **chưa thu hồi** của user; trả số dòng đổi. */
  revokeAllForUser(userId: string, reason: RefreshTokenRevokeReason, at: Date): Promise<number>;
  /**
   * Fallback cho `authenticate` khi cache lỗi: phiên `familyId` đã bị đăng xuất / phát hiện reuse?
   * (LOGOUT_ALL / PASSWORD_CHANGED đã được `token_version` bao phủ.)
   */
  isSessionRevoked(familyId: string): Promise<boolean>;
  /**
   * Phiên của `userId` bị LOGOUT / REUSE_DETECTED từ `since` (một dòng mỗi family, `revokedAt` mới
   * nhất). `authenticate` dùng khi nạp lại cache sau khi Valkey mất dữ liệu (X3, T-032).
   */
  listRevokedSessionsSince(
    userId: string,
    since: Date,
  ): Promise<{ familyId: string; revokedAt: Date }[]>;
}
