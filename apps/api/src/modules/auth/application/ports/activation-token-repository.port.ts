/** Dòng `account_activation_tokens` (ADR-137): chỉ lưu SHA-256 của token, không bao giờ lưu token thô. */
export interface ActivationTokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Token kích hoạt tài khoản — một lần, mỗi user ≤ 1 token sống (unique index một phần
 * `account_activation_tokens_live_key`). Gọi TRONG transaction của bên gọi.
 */
export interface IActivationTokenRepository {
  /** Thu hồi token sống của user (`revoked_at = at`) RỒI thêm token mới — "tạo lại link" giết link cũ ngay. */
  issue(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    /** null = `admin:bootstrap` cấp. */
    createdById: string | null;
    at: Date;
  }): Promise<void>;
  findByHash(tokenHash: string): Promise<ActivationTokenRecord | null>;
  /**
   * `UPDATE … SET used_at = at WHERE id AND used_at IS NULL AND revoked_at IS NULL AND expires_at > at` —
   * `true` khi đếm đúng 1 dòng. Hai request đồng thời ⇒ chỉ một bên thắng.
   */
  consume(id: string, at: Date): Promise<boolean>;
  /** Thu hồi mọi token sống của user (nghỉ việc / xóa — T-062). Trả số dòng. */
  revokeAllForUser(userId: string, at: Date): Promise<number>;
}
