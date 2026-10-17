import type {
  AttendanceCompanyMonthQuery,
  AttendanceCompanyTodayDto,
  AttendanceMemberMonthDto,
  PageMeta,
  UserRefDto,
} from '@taskflow/contracts';
import * as z from 'zod';

import { decodeCursor, encodeCursor } from '../../../../core/http/cursor';
import type { LocalDate } from '../../domain/local-time';
import { isWorkday } from '../../domain/work-schedule';
import { localToday, summarizeUsers, type AttendanceDeps } from '../attendance-days';
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
  async today(): Promise<AttendanceCompanyTodayDto> {
    const { d } = this;
    const now = d.clock.now();
    const { date, schedule, timezone } = localToday(await d.calendar.scheduleVersions(), now);
    const roster = await this.roster(date, date);
    const days = await summarizeUsers(d, {
      userIds: roster.map((r) => r.user.id),
      from: date,
      to: date,
    });
    const [holiday] = await d.calendar.holidays({ from: date, to: date });
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
    q: AttendanceCompanyMonthQuery,
  ): Promise<{ data: AttendanceMemberMonthDto[]; page: PageMeta }> {
    const from = `${q.month}-01`;
    const to = lastDayOf(q.month);
    const roster = await this.roster(from, to);
    const after = q.cursor === undefined ? null : decodeCursor(q.cursor, CURSOR_KIND, AfterKey);
    const rest = after
      ? roster.filter(
          (r) => byName(r, { user: { id: after.id, fullName: after.name }, left: false }) > 0,
        )
      : roster;
    const pageRows = rest.slice(0, q.limit);
    const hasMore = rest.length > q.limit;
    const [days, versions] = await Promise.all([
      summarizeUsers(this.d, { userIds: pageRows.map((r) => r.user.id), from, to }),
      this.d.calendar.scheduleVersions(),
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

  /**
   * Người của khoảng `[from, to]`, đã sắp (dùng chung với xuất CSV): có nhiệm kỳ EMPLOYEE giao khoảng (port trả đúng
   * theo ngày) + người có lượt chấm trong khoảng (đã nghỉ — R30). Admin không có trừ ngày thuộc nhiệm kỳ EMPLOYEE cũ.
   * `left` = không còn nhiệm kỳ đang mở (đã nghỉ / đã lên Admin).
   */
  async roster(from: LocalDate, to: LocalDate): Promise<RosterEntry[]> {
    const { d } = this;
    const [tenures, withEvents] = await Promise.all([
      d.tenures.tenuresOf({ from, to }),
      d.events.userIdsWithEvents({ from, to }),
    ]);
    const ids = [...new Set([...tenures.map((t) => t.userId), ...withEvents])];
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
