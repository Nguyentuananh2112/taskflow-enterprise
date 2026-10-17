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
   * Version lớn nhất CÒN trên đĩa của user (0 nếu không có) — gồm ảnh đã gỡ đang giữ 30 ngày và blob mồ côi của lần
   * rollback. Version mới = max(đã commit, cái này) + 1 ⇒ KHÔNG BAO GIỜ dùng lại version còn blob / còn URL trong cache
   * trình duyệt (URL cùng v + cùng khung exp sẽ trả ảnh cũ) và không va khóa (commit không ghi đè — B).
   */
  latestVersion(userId: string): Promise<number>;
  /** Đặt 2 biến thể của `version` — gọi TRONG transaction khi đang giữ khóa dòng user (`lockAvatar`). */
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
