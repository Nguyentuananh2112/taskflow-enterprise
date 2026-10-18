/**
 * Tài khoản đăng nhập (module auth hiện thực — `AuthAccounts`, khớp cấu trúc; wire ở composition, ADR-093).
 * Mọi lệnh chạy TRONG transaction của bên gọi.
 */
export interface ICompanyAccounts {
  /** Email đã chuẩn hóa (contracts); `null` = chưa có tài khoản. */
  findByEmail(
    email: string,
  ): Promise<{ userId: string; fullName: string; deleted: boolean; hasPassword: boolean } | null>;
  findById(
    userId: string,
  ): Promise<{ userId: string; fullName: string; deleted: boolean; hasPassword: boolean } | null>;
  /** Hồ sơ nhiều tài khoản MỘT truy vấn (email là PII — chỉ route quản trị). `[]` ⇒ Map rỗng. */
  profiles(
    userIds: readonly string[],
  ): Promise<
    ReadonlyMap<string, { fullName: string; email: string; hasPassword: boolean; deleted: boolean }>
  >;
  /** User `password_hash` null (chờ kích hoạt). */
  createPending(input: { email: string; fullName: string }): Promise<{ userId: string }>;
  /** Thu hồi token sống cũ rồi cấp token mới (ADR-137 điều 2). */
  issueActivation(input: {
    userId: string;
    /** null = `admin:bootstrap`. */
    createdById: string | null;
    ttlMs: number;
  }): Promise<{ token: string; link: string; expiresAt: Date }>;
  /** Thu hồi mọi token kích hoạt còn sống (ADR-137 "Hoàn tất" bước 5). Trả số token. */
  revokeActivations(userId: string): Promise<number>;
  /**
   * Thu hồi mọi phiên theo ADR-105 (đổi vai trò Admin / nghỉ việc): `token_version + 1` + thu hồi refresh token
   * + ghi `tv` mới lên Valkey TRƯỚC commit (lỗi ⇒ 503, rollback); `disconnectUser` SAU commit.
   */
  revokeSessions(userId: string, reason: 'OFFBOARDED' | 'LOGOUT_ALL'): Promise<void>;
  /**
   * Mốc 6 (ADR-142): gỡ ảnh đại diện của `userId` TRONG transaction của bên gọi (audit cùng commit). Không có ảnh ⇒
   * `previousVersion: null`. Ảnh đại diện chưa bật ở process này ⇒ 503.
   */
  removeAvatar(input: {
    userId: string;
    actorId: string;
  }): Promise<{ previousVersion: number | null }>;
}
