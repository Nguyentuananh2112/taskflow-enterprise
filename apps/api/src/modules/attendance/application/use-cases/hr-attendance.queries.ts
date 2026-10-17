import type {
  AttendanceCompanyMonthQuery,
  AttendanceCompanyTodayDto,
  AttendanceMemberMonthDto,
  PageMeta,
  UserRefDto,
} from '@taskflow/contracts';
import * as z from 'zod';

import { decodeCursor, encodeCursor } from '../../../../core/http/cursor';
import { toLocal, type LocalDate } from '../../domain/local-time';
import { effectiveSchedule, isWorkday } from '../../domain/work-schedule';
import { localToday, summarizeUsers, tenureWindow, type AttendanceDeps } from '../attendance-days';
import { UNKNOWN_USER } from '../attendance-event-dto';
import { totalsOf } from '../attendance-totals';
import type { IUserRefReader } from '../ports/collaborators.port';
import { lastDayOf } from './my-attendance.queries';

export interface HrAttendanceDeps extends AttendanceDeps {
  users: IUserRefReader;
}

export interface RosterEntry {
  user: UserRefDto;
  left: boolean;
}

const CURSOR_KIND = 'attendance-month';
const AfterKey = z.object({ name: z.string(), id: z.string() });

const byName = (a: RosterEntry, b: RosterEntry) =>
  a.user.fullName.localeCompare(b.user.fullName, 'vi') ||
  (a.user.id < b.user.id ? -1 : a.user.id > b.user.id ? 1 : 0);

/**
 * Bảng công cả công ty (HR, route gác `hr:manage`). Danh sách người của khoảng `[from, to]` = có nhiệm kỳ
 * nhân viên giao khoảng ∪ có lượt chấm trong khoảng (người đã rời vẫn hiện, gắn `left` — R30). Sắp theo tên
 * (so sánh tiếng Việt) rồi id; tháng phân trang theo cursor opaque trên khóa (tên, id).
 */
export class HrAttendanceQueries {
  constructor(private readonly d: HrAttendanceDeps) {}

  /** `GET attendance/today` — không phân trang (vài trăm người). */
  async today(workspaceId: string): Promise<AttendanceCompanyTodayDto> {
    const { d } = this;
    const now = d.clock.now();
    const { date, schedule, timezone } = localToday(
      await d.calendar.scheduleVersions(workspaceId),
      now,
    );
    const roster = await this.roster(workspaceId, date, date);
    const days = await summarizeUsers(d, {
      workspaceId,
      userIds: roster.map((r) => r.user.id),
      from: date,
      to: date,
    });
    const [holiday] = await d.calendar.holidays({ workspaceId, from: date, to: date });
    return {
      serverNow: now.toISOString(),
      date,
      timezone,
      isWorkday: isWorkday(schedule, date),
      isHoliday: holiday !== undefined,
      holidayName: holiday?.name ?? null,
      schedule: {
        startMin: schedule.startMin,
        endMin: schedule.endMin,
        breakStartMin: schedule.breakStartMin,
        breakEndMin: schedule.breakEndMin,
        graceMin: schedule.graceMin,
      },
      members: roster.map((r) => ({ ...r, day: days.get(r.user.id)![0]! })),
    };
  }

  /** `GET attendance?month=&cursor&limit` — mỗi dòng một người, đủ ngày của tháng + tổng. */
  async month(
    workspaceId: string,
    q: AttendanceCompanyMonthQuery,
  ): Promise<{ data: AttendanceMemberMonthDto[]; page: PageMeta }> {
    const from = `${q.month}-01`;
    const to = lastDayOf(q.month);
    const roster = await this.roster(workspaceId, from, to);
    const after = q.cursor === undefined ? null : decodeCursor(q.cursor, CURSOR_KIND, AfterKey);
    const rest = after
      ? roster.filter(
          (r) => byName(r, { user: { id: after.id, fullName: after.name }, left: false }) > 0,
        )
      : roster;
    const pageRows = rest.slice(0, q.limit);
    const hasMore = rest.length > q.limit;
    const [days, versions] = await Promise.all([
      summarizeUsers(this.d, { workspaceId, userIds: pageRows.map((r) => r.user.id), from, to }),
      this.d.calendar.scheduleVersions(workspaceId),
    ]);
    // T-046: tổng chỉ đếm tới HÔM NAY theo lịch (cùng hàm với me?month).
    const today = localToday(versions, this.d.clock.now()).date;
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((r) => {
        const mine = days.get(r.user.id)!;
        return { ...r, days: mine, totals: totalsOf(mine, today) };
      }),
      page: {
        nextCursor:
          hasMore && last
            ? encodeCursor(CURSOR_KIND, { name: last.user.fullName, id: last.user.id })
            : null,
        hasMore,
        limit: q.limit,
      },
    };
  }

  /** Người của khoảng `[from, to]`, đã sắp (dùng chung với xuất CSV). */
  async roster(workspaceId: string, from: LocalDate, to: LocalDate): Promise<RosterEntry[]> {
    const { d } = this;
    const [versions, tenures, withEvents] = await Promise.all([
      d.calendar.scheduleVersions(workspaceId),
      d.tenures.tenuresOf({ workspaceId, ...tenureWindow(from, to) }),
      d.events.userIdsWithEvents({ workspaceId, from, to }),
    ]);
    // Cửa sổ instant nới ±1 ngày ⇒ lọc lại theo ngày địa phương (múi giờ lịch ở hai đầu khoảng).
    const inRange = tenures.filter(
      (t) =>
        toLocal(t.from, effectiveSchedule(versions, to).timezone).date <= to &&
        (t.until === null ||
          toLocal(t.until, effectiveSchedule(versions, from).timezone).date >= from),
    );
    const ids = [...new Set([...inRange.map((t) => t.userId), ...withEvents])];
    const current = new Set(tenures.filter((t) => t.until === null).map((t) => t.userId));
    const refs = await d.users.findRefs(ids);
    return ids
      .map((id) => ({
        user: refs.get(id) ?? { id, fullName: UNKNOWN_USER },
        left: !current.has(id),
      }))
      .sort(byName);
  }
}
