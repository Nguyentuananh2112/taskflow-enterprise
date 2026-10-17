import type { LocalDate } from '../../domain/local-time';

/**
 * Cửa sổ lưu dữ liệu chấm công (T-047, R27 — job retention T-043 xóa lượt chấm có `work_date < mốc`). Attendance sở
 * hữu, nối ở composition root từ CHÍNH hàm mốc của job (`recordsRetentionCutoff`, theo giờ nghiệp vụ) và CHỈ khi job
 * thực sự bật (`isRetentionActive`) — job tắt (local/test mặc định) ⇒ dữ liệu cũ còn nguyên ⇒ `null` = không áp.
 */
export interface IRetentionWindow {
  /** Ngày công `< mốc` đã / sẽ bị job xóa: bảng công hiện RETENTION_EXPIRED, lệnh ghi ⇒ 422 OUTSIDE_RETENTION. */
  recordsCutoffDate(): LocalDate | null;
}
