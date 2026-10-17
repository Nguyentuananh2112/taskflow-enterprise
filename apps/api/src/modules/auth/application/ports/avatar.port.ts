// Mốc 6 — ảnh đại diện (ADR-142, T-068). Auth sở hữu `users.avatar_version`; kho tệp / sharp / URL ký / realtime là
// hạ tầng dùng chung — composition root nối (ADR-016), module không import `core/files` infrastructure.

export type AvatarVariant = '256' | '64';

/** Bản tạm của upload (rawUpload) mà use case cần — đọc trọn vào bộ nhớ (≤ 5 MB) cho worker sharp. */
export interface AvatarUpload {
  /** Tên đã làm sạch (chỉ để đoán đuôi khi sniff). */
  name: string;
  head: Buffer;
  sizeBytes: number;
  readAll(): Promise<Buffer>;
}

/**
 * Upload ⇒ 2 biến thể WebP 256 / 64 vuông, không metadata. Không phải ảnh JPEG/PNG/WebP/GIF ⇒ 415; ảnh hỏng ⇒ 422
 * `IMAGE_UNREADABLE`; quá trần điểm ảnh của avatar / quá giờ ⇒ 422 `IMAGE_TOO_COMPLEX`; hàng đợi đầy ⇒ 503.
 */
export interface IAvatarImages {
  render(upload: AvatarUpload): Promise<ReadonlyMap<AvatarVariant, Buffer>>;
}

export interface IAvatarBlobs {
  /**
   * Đặt 2 biến thể của `version` — gọi TRONG transaction khi đang giữ khóa dòng user (`lockAvatar`). `version` lớn hơn
   * mọi version đã commit ⇒ blob cũ cùng khóa (nếu có) chắc chắn mồ côi của một lần rollback trước — được thay (B).
   */
  place(
    userId: string,
    version: number,
    variants: ReadonlyMap<AvatarVariant, Buffer>,
  ): Promise<void>;
  /** Xóa ngay (đổi ảnh ⇒ version cũ — ADR-142). Idempotent, best-effort sau commit; sweep là lưới. */
  discard(userId: string, version: number): Promise<void>;
  /** Gỡ ảnh (tự gỡ / bị gỡ) ⇒ blob GIỮ 30 ngày tính từ `at` để phục hồi nếu gỡ nhầm (D13, B) — sweep xóa sau. */
  markRemoved(userId: string, version: number, at: Date): Promise<void>;
}

export interface AvatarUrls {
  /** Variant 64 — mọi `UserRefDto`, event. */
  avatarUrl: string;
  /** Variant 256 — chỉ `UserDto` của người đang đăng nhập. */
  avatarUrlLarge: string;
}

export interface IAvatarUrls {
  urlsOf(userId: string, version: number): AvatarUrls;
}

/**
 * `user:avatar-changed {userId, avatarUrl 64 | null}` — sau commit. Chỉ variant 64, KHÔNG avatarUrlLarge (TL).
 */
export interface IAvatarChangedNotifier {
  avatarChanged(input: {
    userId: string;
    avatarUrl: string | null;
    actorId: string;
  }): Promise<void>;
}
