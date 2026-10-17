import type { AttendanceDayDto, DayStatus, YearMonth } from '@taskflow/contracts';

import { daysBetween, toLocal, weekdayOf } from '../../domain/local-time';
import { summarizeUsers, type AttendanceDeps } from '../attendance-days';
import { CSV_BOM, csvCell, csvRow } from '../csv';
import type { IHrAccess, IHrAuditRecorder, IUserRefReader } from '../ports/collaborators.port';
import { HrAttendanceQueries, type RosterEntry } from './hr-attendance.queries';
import { lastDayOf } from './my-attendance.queries';

export interface AttendanceExportDeps extends AttendanceDeps {
  users: IUserRefReader;
  hrAccess: IHrAccess;
  audit: IHrAuditRecorder;
}

const STATUS_LABEL: Record<DayStatus, string> = {
  RETENTION_EXPIRED: 'Ngoài thời hạn lưu',
  NOT_EMPLOYED: 'Chưa/không còn làm',
  HOLIDAY: 'Nghỉ lễ',
  OFF: 'Ngày nghỉ',
  ON_LEAVE: 'Nghỉ phép',
  PRESENT: 'Có mặt',
  MISSING_OUT: 'Thiếu giờ ra',
  ABSENT: 'Vắng',
  PENDING: 'Chưa tới',
};
const WEEKDAY = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const LEAVE_LABEL = { FULL: 'Cả ngày', AM: 'Buổi sáng', PM: 'Buổi chiều' } as const;

const HEADER = [
  'Họ tên',
  'Đã nghỉ việc',
  'Ngày',
  'Thứ',
  'Trạng thái',
  'Giờ vào',
  'Giờ ra',
  'Phút làm',
  'Đi muộn (phút)',
  'Về sớm (phút)',
  'Nghỉ phép',
  'Ngày lễ',
];

/** Giờ địa phương HH:mm theo múi giờ lịch của ngày; ra sau nửa đêm ⇒ "00:30 (+1)". */
function clock(iso: string | null, day: AttendanceDayDto): string {
  if (!iso) return '';
  const local = toLocal(new Date(iso), day.timezone);
  const hhmm = `${String(Math.floor(local.minute / 60)).padStart(2, '0')}:${String(local.minute % 60).padStart(2, '0')}`;
  const plus = daysBetween(day.date, local.date);
  return plus > 0 ? `${hhmm} (+${plus})` : hhmm;
}

/** Số người mỗi lô khi stream (khớp trang HR). */
const BATCH = 50;

/**
 * `GET attendance/export.csv?month=` (HR): cả công ty, mỗi dòng = một người × một ngày, KHÔNG có IP / UA / lý
 * do nghỉ (§9). Quyền đọc lại + audit EXPORT (tháng + số dòng) trong transaction TRƯỚC khi trả byte nào; sau
 * đó stream theo lô 50 người (không giữ cả bảng trong bộ nhớ).
 */
export class AttendanceExportUseCase {
  readonly #hr: HrAttendanceQueries;
  constructor(private readonly d: AttendanceExportDeps) {
    this.#hr = new HrAttendanceQueries(d);
  }

  async start(
    workspaceId: string,
    actorId: string,
    month: YearMonth,
  ): Promise<{ rows: number; lines: AsyncGenerator<string> }> {
    const { d } = this;
    const from = `${month}-01`;
    const to = lastDayOf(month);
    let roster: RosterEntry[] = [];
    let rows = 0;
    await d.uow.run(async () => {
      await d.hrAccess.authorizeWrite({ workspaceId, actorId });
      roster = await this.#hr.roster(workspaceId, from, to);
      rows = roster.length * (daysBetween(from, to) + 1);
      await d.audit.record({
        workspaceId,
        actorId,
        action: 'EXPORT',
        after: { kind: 'attendance_month', month, rows },
      });
    });
    return { rows, lines: this.#lines(workspaceId, roster, from, to) };
  }

  async *#lines(
    workspaceId: string,
    roster: RosterEntry[],
    from: string,
    to: string,
  ): AsyncGenerator<string> {
    yield CSV_BOM + csvRow(HEADER.map((h) => csvCell(h)));
    for (let i = 0; i < roster.length; i += BATCH) {
      const batch = roster.slice(i, i + BATCH);
      const days = await summarizeUsers(this.d, {
        workspaceId,
        userIds: batch.map((r) => r.user.id),
        from,
        to,
      });
      let chunk = '';
      for (const r of batch) {
        for (const day of days.get(r.user.id)!) {
          chunk += csvRow([
            csvCell(r.user.fullName, 'text'),
            csvCell(r.left ? 'Có' : ''),
            csvCell(day.date),
            csvCell(WEEKDAY[weekdayOf(day.date)]!),
            csvCell(STATUS_LABEL[day.status]),
            csvCell(clock(day.firstIn, day)),
            csvCell(clock(day.lastOut, day)),
            csvCell(day.workedMin),
            csvCell(day.lateMin),
            csvCell(day.earlyMin),
            csvCell(day.leave ? LEAVE_LABEL[day.leave] : ''),
            csvCell(day.holidayName ?? '', 'text'),
          ]);
        }
      }
      yield chunk;
    }
  }
}
