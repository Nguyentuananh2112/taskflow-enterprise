import { BusinessRuleViolationError } from '../../../core/errors';
import type { LocalDate } from '../domain/local-time';
import type { IRetentionWindow } from './ports/retention-window.port';

/**
 * T-047 (R27): ghi vào ngày công `< mốc lưu` của job retention đang bật ⇒ 422 OUTSIDE_RETENTION — dữ liệu ngày đó đã /
 * sẽ bị xóa, sửa vào là mất ngay đêm đó. Job tắt (mốc null) ⇒ không chặn. Gọi SAU kiểm quyền (thứ tự lỗi §5).
 */
export function assertInsideRetention(retention: IRetentionWindow, date: LocalDate): void {
  const cutoff = retention.recordsCutoffDate();
  if (cutoff !== null && date < cutoff) {
    throw new BusinessRuleViolationError(
      'OUTSIDE_RETENTION',
      `Ngày ${date} đã quá thời hạn lưu dữ liệu chấm công (dữ liệu trước ${cutoff} bị xóa theo chính sách) — không sửa được.`,
    );
  }
}
