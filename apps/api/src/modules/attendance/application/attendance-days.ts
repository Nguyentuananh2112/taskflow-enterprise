import type { AttendanceDayDto, AttendanceTodayDto } from '@taskflow/contracts';

import type { IClock, IIdGenerator } from '../../../core/domain';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import { addDays, daysBetween, toLocal, type LocalDate } from '../domain/local-time';
import { summarizeDay, type LeavePart } from '../domain/summarize-day';
import { employedOn } from '../domain/tenure';
import {
  DEFAULT_SCHEDULE,
  effectiveSchedule,
  isWorkday,
  type WorkSchedule,
} from '../domain/work-schedule';
import type { ApprovedLeavePort } from './ports/approved-leave.port';
import type { IAttendanceEventStore } from './ports/attendance-event-store.port';
import type { IMembershipTenurePort } from './ports/membership-tenure.port';
import type { IWorkCalendarStore } from './ports/work-calendar-store.port';

export interface AttendanceDeps {
  events: IAttendanceEventStore;
  calendar: IWorkCalendarStore;
  leaves: ApprovedLeavePort;
  tenures: IMembershipTenurePort;
  clock: IClock;
  ids: IIdGenerator;
  uow: IUnitOfWork;
}

/** Múi giờ của lịch mặc định (workspace chưa lưu lịch nào). */
export const DEFAULT_TIMEZONE = DEFAULT_SCHEDULE.timezone;

/**
 * "Hôm nay" theo múi giờ của LỊCH hiệu lực. Múi giờ phụ thuộc phiên bản, phiên bản phụ thuộc ngày ⇒ ước
 * lượng ngày bằng múi giờ của phiên bản mới nhất rồi chọn lại phiên bản hiệu lực cho đúng ngày đó.
 */
export function localToday(
  versions: readonly WorkSchedule[],
  now: Date,
): { date: LocalDate; schedule: WorkSchedule; timezone: string } {
  const latest = versions.reduce<WorkSchedule | null>(
    (a, v) => (!a || v.effectiveFrom > a.effectiveFrom ? v : a),
    null,
  );
  const guess = toLocal(now, latest?.timezone ?? DEFAULT_TIMEZONE).date;
  const schedule = effectiveSchedule(versions, guess);
  return { date: toLocal(now, schedule.timezone).date, schedule, timezone: schedule.timezone };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const DAY_MS = 86_400_000;
/**
 * Cửa sổ instant phủ mọi ngày địa phương `[from, to]` ở MỌI múi giờ (lệch ≤ ±14 h): 00:00Z(from) − 1 ngày tới
 * 00:00Z(to) + 2 ngày; `employedOn` lọc chính xác theo múi giờ lịch.
 */
export const tenureWindow = (from: LocalDate, to: LocalDate) => ({
  from: new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS),
  to: new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY_MS),
});

/**
 * Bảng công của NHIỀU người cho các ngày `[from, to]` (gồm cả hai đầu) — tính khi đọc (ADR-121), không lưu
 * bảng tổng hợp; đọc theo lô (5 truy vấn cho cả trang). Ngày chưa có phiên bản lịch ⇒ lịch mặc định.
 */
export async function summarizeUsers(
  d: AttendanceDeps,
  q: { workspaceId: string; userIds: readonly string[]; from: LocalDate; to: LocalDate },
): Promise<Map<string, AttendanceDayDto[]>> {
  const { workspaceId, userIds, from, to } = q;
  const [versions, holidays, leaves, events, tenures] = await Promise.all([
    d.calendar.scheduleVersions(workspaceId),
    d.calendar.holidays({ workspaceId, from, to }),
    d.leaves.approvedLeaves({ workspaceId, userIds, from, to }),
    d.events.listForUsers({ workspaceId, userIds, from, to }),
    d.tenures.tenuresOf({ workspaceId, userIds, ...tenureWindow(from, to) }),
  ]);
  const holidayOf = new Map(holidays.map((h) => [h.date, h.name]));
  const now = d.clock.now();
  const dates = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
  const schedules = new Map(dates.map((date) => [date, effectiveSchedule(versions, date)]));
  const result = new Map<string, AttendanceDayDto[]>();
  for (const userId of userIds) {
    const leaveOf = new Map<LocalDate, LeavePart>(
      leaves.filter((l) => l.userId === userId).map((l) => [l.date, l.part]),
    );
    const mine = events.filter((e) => e.userId === userId);
    const myTenures = tenures.filter((t) => t.userId === userId);
    result.set(
      userId,
      dates.map((date) => {
        const schedule = schedules.get(date)!;
        const holidayName = holidayOf.get(date) ?? null;
        const leave = leaveOf.get(date) ?? null;
        const s = summarizeDay({
          date,
          events: mine.filter((e) => e.workDate === date),
          schedule,
          holiday: holidayName !== null,
          leave,
          employed: employedOn(myTenures, date, schedule.timezone),
          now,
        });
        return {
          date,
          timezone: schedule.timezone,
          isWorkday: isWorkday(schedule, date),
          holidayName,
          workedMin: s.workedMin,
          lateMin: s.lateMin,
          earlyMin: s.earlyMin,
          status: s.status,
          late: s.flags.late,
          early: s.flags.early,
          absentHalf: s.flags.absentHalf,
          inProgress: s.flags.inProgress,
          firstIn: iso(s.firstIn),
          lastOut: iso(s.lastOut),
          leave,
        };
      }),
    );
  }
  return result;
}

/** Bảng công của MỘT người (`me?month=`, ô ngày sau ADJUSTMENT / void). */
export async function summarizeRange(
  d: AttendanceDeps,
  q: { workspaceId: string; userId: string; from: LocalDate; to: LocalDate },
): Promise<AttendanceDayDto[]> {
  const days = await summarizeUsers(d, { ...q, userIds: [q.userId] });
  return days.get(q.userId)!;
}

/** Thẻ chấm công hôm nay (`GET attendance/me/today`, cũng là body của check-in/out). */
export async function todayCard(
  d: AttendanceDeps,
  q: { workspaceId: string; userId: string },
): Promise<AttendanceTodayDto> {
  const now = d.clock.now();
  const { date, schedule, timezone } = localToday(
    await d.calendar.scheduleVersions(q.workspaceId),
    now,
  );
  const [day] = await summarizeRange(d, { ...q, from: date, to: date });
  const { workedMin: _w, lateMin: _l, earlyMin: _e, timezone: _tz, ...flags } = day!;
  return {
    serverNow: now.toISOString(),
    timezone,
    isHoliday: day!.holidayName !== null,
    schedule: {
      startMin: schedule.startMin,
      endMin: schedule.endMin,
      breakStartMin: schedule.breakStartMin,
      breakEndMin: schedule.breakEndMin,
      graceMin: schedule.graceMin,
    },
    ...flags,
  };
}
