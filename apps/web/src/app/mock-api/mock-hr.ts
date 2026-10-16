import type { UserRefDto } from '@taskflow/contracts/auth';

import type {
  HolidayDto,
  HrDayDto,
  AttendanceMemberMonthDto,
  WorkScheduleDto,
} from '@/shared/api/m3-provisional';

import { MOCK_TZ, type MockAttendance } from './mock-attendance';
import type { MockDb } from './mock-db';
import type { MockLeave } from './mock-leave';
import { fail } from './respond';

// Phía HR của mock (T-041c, attendance-leave.md §5 — DTO A/D chốt): lịch theo phiên bản, ngày lễ, và
// ngày công "nhìn từ HR" = `MockAttendance.summarize` + ngày lễ + nghỉ đã duyệt (bản RÚT GỌN của
// `summarizeDay`; quy tắc đầy đủ thuộc API thật T-038). Lịch HR lưu chỉ để hiển thị — mock vẫn tính
// công theo lịch mặc định.

export class MockHr {
  schedules = new Map<string, WorkScheduleDto[]>();
  holidays = new Map<string, HolidayDto[]>();
  constructor(
    readonly db: MockDb,
    readonly attendance: MockAttendance,
    readonly leave: MockLeave,
  ) {}

  holidayOn(wsId: string, date: string): HolidayDto | undefined {
    return this.holidays.get(wsId)?.find((h) => h.date === date);
  }

  day(wsId: string, userId: string, date: string): HrDayDto {
    const base = this.attendance.summarize(wsId, userId, date);
    const holiday = this.holidayOn(wsId, date);
    const leave = this.leave.items.find(
      (l) =>
        l.workspaceId === wsId &&
        l.userId === userId &&
        l.status === 'APPROVED' &&
        l.startDate <= date &&
        date <= l.endDate,
    );
    const day: HrDayDto = { ...base, timezone: MOCK_TZ };
    if (holiday) return { ...day, status: 'HOLIDAY', holidayName: holiday.name };
    if (leave && base.isWorkday) {
      const part = leave.dayPart;
      return part === 'FULL'
        ? { ...day, status: 'ON_LEAVE', leave: 'FULL' }
        : { ...day, leave: part };
    }
    return day;
  }

  /** Nhân viên hiện tại (không VIEWER) + người đã rời có lượt chấm trong khoảng (`left`), sắp theo tên. */
  people(wsId: string, from: string, to: string): Array<{ user: UserRefDto; left: boolean }> {
    const current = this.db
      .membersOf(wsId)
      .filter((m) => m.membership.role !== 'VIEWER')
      .map((m) => ({ user: { id: m.user.id, fullName: m.user.fullName }, left: false }));
    const ids = new Set(current.map((p) => p.user.id));
    const gone = [...this.attendance.usersWithPunches(wsId, from, to)]
      .filter((id) => !ids.has(id))
      .flatMap((id) => {
        const u = this.db.getUser(id);
        return u ? [{ user: { id, fullName: u.fullName }, left: true }] : [];
      });
    return [...current, ...gone].sort(
      (a, b) =>
        a.user.fullName.localeCompare(b.user.fullName, 'vi') || a.user.id.localeCompare(b.user.id),
    );
  }

  /** Có dữ liệu trong workspace (thành viên hiện tại hoặc từng chấm công) — không thì 404. */
  known(wsId: string, userId: string): boolean {
    return (
      this.db.workspaces.member(wsId, userId) !== undefined ||
      this.attendance.usersWithPunches(wsId, '0000-01-01', '9999-12-31').has(userId)
    );
  }
}

export function monthDays(month: string): string[] {
  const [y = 0, m = 1] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function totalsOf(days: readonly HrDayDto[]): AttendanceMemberMonthDto['totals'] {
  const sum = (f: (d: HrDayDto) => number) => days.reduce((n, d) => n + f(d), 0);
  return {
    workedMin: sum((d) => d.workedMin),
    lateDays: sum((d) => (d.late ? 1 : 0)),
    lateMin: sum((d) => d.lateMin),
    earlyDays: sum((d) => (d.early ? 1 : 0)),
    earlyMin: sum((d) => d.earlyMin),
    absentDays: sum((d) => (d.status === 'ABSENT' ? (d.absentHalf ? 0.5 : 1) : 0)),
    leaveDays: sum((d) => (d.leave === 'FULL' ? 1 : d.leave ? 0.5 : 0)),
    missingOutDays: sum((d) => (d.status === 'MISSING_OUT' ? 1 : 0)),
  };
}

export const ruleFail = (rule: string, extra: object = {}) =>
  fail(422, 'BUSINESS_RULE_VIOLATION', { rule, ...extra });
export const conflictFail = (reason: string) => fail(409, 'RESOURCE_CONFLICT', { reason });

/** Giờ 'HH:mm' theo lịch (mock: Asia/Ho_Chi_Minh, +07:00 cố định) của ngày `date` ⇒ epoch ms. */
export function localToEpoch(date: string, time: string, nextDay = false): number {
  return Date.parse(`${date}T${time}:00+07:00`) + (nextDay ? 86_400_000 : 0);
}

/** OWASP CSV injection: ô CHỮ bắt đầu bằng = + - @ \t \r ⇒ thêm `'`; bọc mọi ô bằng `"`. */
export function csvCell(value: string | number, text = true): string {
  const s = String(value);
  const safe = text && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
