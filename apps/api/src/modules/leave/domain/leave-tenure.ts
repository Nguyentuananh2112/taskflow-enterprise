import { BusinessRuleViolationError } from '../../../core/errors';
import {
  countLeaveHalfDays,
  type CalendarDate,
  type CalendarDay,
  type HalfDays,
  type LeaveSpan,
} from './leave-days';
import type { LeaveStatus } from './leave-status';

/**
 * Nhiệm kỳ nhân viên bằng NGÀY (company-level.md ADR-133): `[from, until]`, `until = null` ⇒ đang làm. So chuỗi
 * `YYYY-MM-DD`, không instant (A C1).
 */
export interface LeaveTenure {
  readonly from: CalendarDate;
  readonly until: CalendarDate | null;
}

/**
 * Đã có lịch nghỉ việc (D H1): đơn có ngày nào sau `lastDay` ⇒ 422 `AFTER_LAST_DAY` — ở submit, approve, preview.
 * Không có lịch nghỉ ⇒ không kiểm.
 */
export function assertNotAfterLastDay(span: LeaveSpan, lastDay: CalendarDate | null): void {
  if (lastDay !== null && span.endDate > lastDay) {
    throw new BusinessRuleViolationError(
      'AFTER_LAST_DAY',
      'Đơn có ngày sau ngày làm việc cuối cùng.',
      { lastDay },
    );
  }
}

/**
 * Phần của đơn nằm trong nhiệm kỳ (đếm KHI ĐỌC — đơn APPROVED vắt qua `lastDay` giữ nguyên bản ghi, chỉ ngày trong
 * nhiệm kỳ bị trừ phép). Ngoài hẳn ⇒ `null`. AM/PM là đơn một ngày ⇒ còn nguyên hoặc `null`.
 */
export function clipToTenure(span: LeaveSpan, tenure: LeaveTenure): LeaveSpan | null {
  const startDate = span.startDate > tenure.from ? span.startDate : tenure.from;
  const endDate =
    tenure.until !== null && span.endDate > tenure.until ? tenure.until : span.endDate;
  if (endDate < startDate) return null;
  return { startDate, endDate, dayPart: span.dayPart };
}

/** Số nửa ngày của đơn thuộc nhiệm kỳ — `countLeaveHalfDays` trên phần đã cắt. */
export function countTenureHalfDays(
  span: LeaveSpan,
  calendar: readonly CalendarDay[],
  tenure: LeaveTenure,
): HalfDays {
  const clipped = clipToTenure(span, tenure);
  return clipped === null ? 0 : countLeaveHalfDays(clipped, calendar);
}

/**
 * Nhận lại cùng năm (D H2): số dư năm Y chỉ tính đơn **bắt đầu** từ ngày đầu nhiệm kỳ hiện tại; đơn của nhiệm kỳ
 * trước (kể cả APPROVED) không trừ vào phép của nhiệm kỳ mới.
 */
export function belongsToTenure(
  request: { startDate: CalendarDate },
  tenure: LeaveTenure,
): boolean {
  return (
    request.startDate >= tenure.from && (tenure.until === null || request.startDate <= tenure.until)
  );
}

export interface OffboardCleanupStep {
  readonly id: string;
  readonly from: LeaveStatus;
  readonly to: 'CANCELLED' | 'REVOKED';
}

/**
 * Hành động HỆ THỐNG khi hoàn tất nghỉ việc / nâng lên Admin (company-level.md ADR-137 bước 4, D H1) — KHÔNG đi
 * qua bảng chuyển của người dùng (§9): PENDING (mọi ngày) ⇒ CANCELLED; APPROVED bắt đầu sau `lastDay` ⇒ REVOKED
 * (bỏ điều kiện "chưa tới ngày bắt đầu" — `lastDay` có thể đã qua); APPROVED vắt qua `lastDay` giữ nguyên (đếm
 * cắt theo nhiệm kỳ khi đọc); trạng thái kết thúc không đổi. Thứ tự kết quả theo đầu vào (bên gọi sắp sẵn).
 */
export function offboardCleanupPlan(
  requests: readonly { id: string; status: LeaveStatus; startDate: CalendarDate }[],
  lastDay: CalendarDate,
): OffboardCleanupStep[] {
  const steps: OffboardCleanupStep[] = [];
  for (const r of requests) {
    if (r.status === 'PENDING') steps.push({ id: r.id, from: r.status, to: 'CANCELLED' });
    else if (r.status === 'APPROVED' && r.startDate > lastDay) {
      steps.push({ id: r.id, from: r.status, to: 'REVOKED' });
    }
  }
  return steps;
}
