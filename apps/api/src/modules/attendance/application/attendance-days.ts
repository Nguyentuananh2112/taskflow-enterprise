import type { AttendanceDayDto, AttendanceTodayDto } from '@taskflow/contracts';

import type { IClock, IIdGenerator } from '../../../core/domain';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import { addDays, daysBetween, toLocal, type LocalDate } from '../domain/local-time';
import { summarizeDay, type LeavePart } from '../domain/summarize-day';
import { isWorkday, scheduleFor, type WorkSchedule } from '../domain/work-schedule';
import type { ApprovedLeavePort } from './ports/approved-leave.port';
import type { IAttendanceEventStore } from './ports/attendance-event-store.port';
import type { IWorkCalendarStore } from './ports/work-calendar-store.port';

export interface AttendanceDeps {
  events: IAttendanceEventStore;
  calendar: IWorkCalendarStore;
  leaves: ApprovedLeavePort;
  clock: IClock;
  ids: IIdGenerator;
  uow: IUnitOfWork;
}

/** Workspace chưa có phiên bản lịch nào (không xảy ra sau migration seed) ⇒ múi giờ mặc định, mọi ngày OFF. */
export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * "Hôm nay" theo múi giờ của LỊCH hiệu lực. Múi giờ phụ thuộc phiên bản, phiên bản phụ thuộc ngày ⇒ ước
 * lượng ngày bằng múi giờ của phiên bản mới nhất rồi chọn lại phiên bản hiệu lực cho đúng ngày đó.
 */
export function localToday(
  versions: readonly WorkSchedule[],
  now: Date,
): { date: LocalDate; schedule: WorkSchedule | null; timezone: string } {
  const latest = versions.reduce<WorkSchedule | null>(
    (a, v) => (!a || v.effectiveFrom > a.effectiveFrom ? v : a),
    null,
  );
  const guess = toLocal(now, latest?.timezone ?? DEFAULT_TIMEZONE).date;
  const schedule = scheduleFor(versions, guess);
  const timezone = schedule?.timezone ?? DEFAULT_TIMEZONE;
  return { date: toLocal(now, timezone).date, schedule, timezone };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Bảng công của MỘT người cho các ngày `[from, to]` (gồm cả hai đầu) — tính khi đọc (ADR-121), không lưu
 * bảng tổng hợp. Ngày không có lịch hiệu lực ⇒ OFF.
 */
export async function summarizeRange(
  d: AttendanceDeps,
  q: { workspaceId: string; userId: string; from: LocalDate; to: LocalDate },
): Promise<AttendanceDayDto[]> {
  const [versions, holidays, leaves, events] = await Promise.all([
    d.calendar.scheduleVersions(q.workspaceId),
    d.calendar.holidays(q),
    d.leaves.approvedLeaves({
      workspaceId: q.workspaceId,
      userIds: [q.userId],
      from: q.from,
      to: q.to,
    }),
    d.events.listForUser(q),
  ]);
  const holidayOf = new Map(holidays.map((h) => [h.date, h.name]));
  const leaveOf = new Map<LocalDate, LeavePart>(
    leaves.filter((l) => l.userId === q.userId).map((l) => [l.date, l.part]),
  );
  const now = d.clock.now();
  const days: AttendanceDayDto[] = [];
  for (let i = 0; i <= daysBetween(q.from, q.to); i += 1) {
    const date = addDays(q.from, i);
    const schedule = scheduleFor(versions, date);
    const holidayName = holidayOf.get(date) ?? null;
    const leave = leaveOf.get(date) ?? null;
    const dayEvents = events.filter((e) => e.workDate === date);
    if (!schedule) {
      days.push(offDay(date, holidayName, leave));
      continue;
    }
    const s = summarizeDay({
      date,
      events: dayEvents,
      schedule,
      holiday: holidayName !== null,
      leave,
      now,
    });
    days.push({
      date,
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
    });
  }
  return days;
}

function offDay(
  date: LocalDate,
  holidayName: string | null,
  leave: LeavePart | null,
): AttendanceDayDto {
  return {
    date,
    isWorkday: false,
    holidayName,
    workedMin: 0,
    lateMin: 0,
    earlyMin: 0,
    status: holidayName !== null ? 'HOLIDAY' : 'OFF',
    late: false,
    early: false,
    absentHalf: false,
    inProgress: false,
    firstIn: null,
    lastOut: null,
    leave,
  };
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
  const { workedMin: _w, lateMin: _l, earlyMin: _e, ...flags } = day!;
  return {
    serverNow: now.toISOString(),
    timezone,
    isHoliday: day!.holidayName !== null,
    schedule: schedule
      ? {
          startMin: schedule.startMin,
          endMin: schedule.endMin,
          breakStartMin: schedule.breakStartMin,
          breakEndMin: schedule.breakEndMin,
          graceMin: schedule.graceMin,
        }
      : null,
    ...flags,
  };
}
