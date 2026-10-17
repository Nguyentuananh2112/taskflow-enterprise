import type { DayStatus } from '../domain/summarize-day';
import {
  payrollDaysOf,
  standardDaysOf,
  type PayrollDaysResult,
  type PayrollLeaveHalf,
} from '../domain/payroll-days';
import { lastDayOf, summarizeUsers, type AttendanceDeps } from './attendance-days';

export interface PayrollPeriodDays {
  /** Công chuẩn `S` của kỳ (cùng cho mọi người) — ảnh chụp vào `PayrollRun.standardDays`. */
  standardDays: number;
  /** Công tính lương từng người (nửa ngày) hoặc `ATTENDANCE_RETENTION_EXPIRED`. */
  byUser: ReadonlyMap<string, PayrollDaysResult>;
}

/**
 * Công tính lương của kỳ `YYYY-MM` cho `userIds` (payroll.md ADR-126, T-049) — module payroll gọi qua port. Phép đã
 * duyệt đọc MỘT lần (có loại) và dùng cho CẢ ô ngày (`summarizeUsers`) lẫn các nửa ngày; số truy vấn cố định cho cả lô
 * (không N+1).
 */
export async function payrollDaysFor(
  d: AttendanceDeps,
  q: { userIds: readonly string[]; period: string },
): Promise<PayrollPeriodDays> {
  const from = `${q.period}-01`;
  const to = lastDayOf(q.period);
  const [schedules, leaves, tenures] = await Promise.all([
    d.calendar.scheduleVersions(),
    d.leaves.approvedLeaves({ userIds: q.userIds, from, to }),
    d.tenures.tenuresOf({ userIds: q.userIds, from, to }),
  ]);
  const days = await summarizeUsers(d, { userIds: q.userIds, from, to }, leaves);
  const retentionCutoff = d.retention.recordsCutoffDate();
  const byUser = new Map<string, PayrollDaysResult>();
  for (const userId of q.userIds) {
    const halves: PayrollLeaveHalf[] = leaves
      .filter((l) => l.userId === userId)
      .flatMap((l) =>
        (l.part === 'FULL' ? (['AM', 'PM'] as const) : [l.part]).map((part) => ({
          date: l.date,
          part,
          type: l.type,
        })),
      );
    byUser.set(
      userId,
      payrollDaysOf({
        from,
        to,
        statusOf: new Map<string, DayStatus>(
          (days.get(userId) ?? []).map((day) => [day.date, day.status as DayStatus]),
        ),
        leaves: halves,
        schedules,
        tenures: tenures.filter((t) => t.userId === userId),
        retentionCutoff,
      }),
    );
  }
  return { standardDays: standardDaysOf({ from, to, schedules }), byUser };
}

/**
 * Người trong kỳ (payroll.md ADR-127): mọi user có một đoạn nhiệm kỳ EMPLOYEE GIAO tháng — đang làm, đã nghỉ trong tháng,
 * lên Admin trong tháng. Admin chưa từng là nhân viên trong tháng ⇒ không có. Sắp theo userId.
 */
export async function payrollMembersOf(d: AttendanceDeps, period: string): Promise<string[]> {
  const tenures = await d.tenures.tenuresOf({ from: `${period}-01`, to: lastDayOf(period) });
  return [...new Set(tenures.map((t) => t.userId))].sort();
}
