import type { AttendanceDayDto } from '@taskflow/contracts/attendance';
import type { AttendanceKind } from '@taskflow/contracts/hr';

/** Ngày đầu tháng trước của `today` (YYYY-MM-DD) — cửa sổ gửi đơn = tháng này + tháng trước (người dùng chốt 17/10). */
export function correctionWindowStart(today: string): string {
  const [y = 0, m = 1] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}

/**
 * Loại đơn ngày này cần (ADR-129 — chỉ BỔ SUNG lượt thiếu, không thay giờ đã chấm): thiếu giờ ra ⇒ OUT; vắng / có giờ ra
 * mà không có giờ vào ⇒ IN; còn lại ⇒ null. Ngoài cửa sổ ⇒ null (server vẫn kiểm lại mọi luật).
 */
export function correctionKindFor(day: AttendanceDayDto, today: string): AttendanceKind | null {
  if (day.date > today || day.date < correctionWindowStart(today)) return null;
  if (day.status === 'MISSING_OUT') return 'OUT';
  if (day.status === 'ABSENT' || (day.lastOut !== null && day.firstIn === null)) return 'IN';
  return null;
}
