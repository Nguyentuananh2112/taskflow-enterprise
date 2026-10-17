/**
 * Đọc avatar theo lô cho hiển thị / `/media` / sweep (ADR-142, T-068). "Thuộc công ty" = còn dòng `company_members`
 * (bị xóa lúc hoàn tất nghỉ việc) và tài khoản chưa xóa — người đã nghỉ ⇒ không có trong Map ⇒ `avatarUrl: null`.
 */
export interface IAvatarDirectory {
  /** `avatar_version` của user chưa xóa, còn thuộc công ty, CÓ ảnh. `[]` ⇒ không truy vấn. */
  activeVersions(ids: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** Trạng thái cho bước sweep avatar — mọi id có trong DB (kể cả đã nghỉ / đã xóa). */
  sweepStates(ids: readonly string[]): Promise<ReadonlyMap<string, AvatarSweepState>>;
  /** Người đã nghỉ quá hạn: `avatar_version = NULL` nếu VẪN không thuộc công ty (DB trước, đĩa sau — mẫu T-033). */
  clearDeparted(ids: readonly string[]): Promise<number>;
}

export interface AvatarSweepState {
  version: number | null;
  /** Còn dòng `company_members` và chưa xóa. */
  member: boolean;
  /** Lần rời gần nhất (`company_member_departures.left_at`), null nếu chưa từng rời. */
  leftAt: Date | null;
}
