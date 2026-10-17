import type {
  AttendanceDayDto,
  AttendanceMemberMonthDto,
  DayStatus,
  HolidayDto,
  WorkScheduleDto,
} from '@taskflow/contracts/attendance';
import type { UserRefDto } from '@taskflow/contracts/auth';

import { localDate, type MockAttendance } from './mock-attendance';
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

  day(wsId: string, userId: string, date: string): AttendanceDayDto {
    // Ngày trước khi gia nhập (theo lịch) ⇒ NOT_EMPLOYED (E, TL chốt) — không đè bằng lễ/nghỉ.
    const joined = this.db.workspaces.member(wsId, userId)?.joinedAt;
    const day = this.attendance.summarize(wsId, userId, date, joined && localDate(joined));
    if (day.status === 'NOT_EMPLOYED') return day;
    const holiday = this.holidayOn(wsId, date);
    const leave = this.leave.items.find(
      (l) =>
        l.workspaceId === wsId &&
        l.userId === userId &&
        l.status === 'APPROVED' &&
        l.startDate <= date &&
        date <= l.endDate,
    );
    if (holiday) return { ...day, status: 'HOLIDAY', holidayName: holiday.name };
    if (leave && day.isWorkday) {
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
    const gone = [...this.usersWithPunches(wsId, from, to)]
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

  /** Lượt theo id trong workspace (HR hủy lượt — id của workspace khác ⇒ không thấy). */
  locate(wsId: string, id: string) {
    for (const { userId, date, punches } of this.attendance.entries(wsId)) {
      const punch = punches.find((x) => x.id === id);
      if (punch) return { userId, date, punch };
    }
    return undefined;
  }

  /** User có lượt chấm trong [from, to] — HR xem cả người đã rời. */
  usersWithPunches(wsId: string, from: string, to: string): Set<string> {
    const out = new Set<string>();
    for (const e of this.attendance.entries(wsId)) {
      if (e.date >= from && e.date <= to) out.add(e.userId);
    }
    return out;
  }

  /** Có dữ liệu trong workspace (thành viên hiện tại hoặc từng chấm công) — không thì 404. */
  known(wsId: string, userId: string): boolean {
    return (
      this.db.workspaces.member(wsId, userId) !== undefined ||
      this.usersWithPunches(wsId, '0000-01-01', '9999-12-31').has(userId)
    );
  }
}

/** Nhãn trạng thái trong CSV (server sinh chữ — như API thật). */
export const CSV_STATUS: Readonly<Record<DayStatus, string>> = {
  RETENTION_EXPIRED: 'Ngoài thời hạn lưu',
  PRESENT: 'Có mặt',
  MISSING_OUT: 'Chưa chấm ra',
  ABSENT: 'Vắng',
  ON_LEAVE: 'Nghỉ phép',
  HOLIDAY: 'Ngày lễ',
  OFF: 'Không phải ngày làm',
  PENDING: 'Chưa tới giờ',
  NOT_EMPLOYED: 'Chưa/không làm việc',
};

export function monthDays(month: string): string[] {
  const [y = 0, m = 1] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** Như `totalsOf` của API (T-046): `today` = hôm nay theo lịch của mock. */
export function totalsOf(
  days: readonly AttendanceDayDto[],
  today: string,
): AttendanceMemberMonthDto['totals'] {
  // Ngày công (không NOT_EMPLOYED / HOLIDAY / OFF); chỉ đếm `date ≤ today`, phép sau đó ⇒ upcomingLeaveDays.
  const workday = (d: AttendanceDayDto) =>
    d.status !== 'RETENTION_EXPIRED' &&
    d.status !== 'NOT_EMPLOYED' &&
    d.status !== 'HOLIDAY' &&
    d.status !== 'OFF';
  const counted = days.filter((d) => workday(d) && d.date <= today);
  const sum = (f: (d: AttendanceDayDto) => number) => counted.reduce((n, d) => n + f(d), 0);
  const leave = (d: AttendanceDayDto) => (d.leave === 'FULL' ? 1 : d.leave ? 0.5 : 0);
  const lastCounted = days.filter((d) => d.date <= today).at(-1)?.date ?? null;
  return {
    workedMin: sum((d) => d.workedMin),
    lateDays: sum((d) => (d.late ? 1 : 0)),
    lateMin: sum((d) => d.lateMin),
    earlyDays: sum((d) => (d.early ? 1 : 0)),
    earlyMin: sum((d) => d.earlyMin),
    absentDays: sum((d) => (d.status === 'ABSENT' ? (d.absentHalf ? 0.5 : 1) : 0)),
    leaveDays: sum(leave),
    missingOutDays: sum((d) => (d.status === 'MISSING_OUT' ? 1 : 0)),
    presentDays: sum((d) => (d.status === 'PRESENT' || d.status === 'MISSING_OUT' ? 1 : 0)),
    upcomingLeaveDays: days
      .filter((d) => workday(d) && d.date > today)
      .reduce((n, d) => n + leave(d), 0),
    throughDate: lastCounted,
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
