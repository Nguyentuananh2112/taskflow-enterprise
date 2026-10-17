import type { AttendanceDayDto } from '@taskflow/contracts';

import { xlsxDate, type CellValue } from '../../../core/export/xlsx/xlsx-writer';

import { daysBetween, weekdayOf, type LocalDate } from '../domain/local-time';
import { summarizeUsers, type AttendanceDeps } from './attendance-days';
import { totalsOf } from './attendance-totals';
import type { RosterEntry } from './use-cases/hr-attendance.queries';
import { clock, LEAVE_LABEL, STATUS_LABEL, WEEKDAY } from './use-cases/attendance-export.use-case';

/** Một ô bảng tính: chuỗi (ghi nguyên văn, chống injection ở writer), số, ngày (`xlsxDate` — serial Excel), trống. */
export type ReportCell = CellValue;

export interface ReportSheet {
  name: string;
  columns: readonly { header: string; width?: number }[];
  rows: AsyncIterable<readonly ReportCell[]>;
}

export interface ReportPacing {
  /** Số người mỗi lô đọc (ExportLimits.batchSize). */
  batchSize: number;
  /** Trễ giữa hai lô (ExportLimits.batchDelayMs — 0 ngoài test). */
  batchDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

/** Ký hiệu ngắn của trạng thái ngày cho sheet ma trận "Theo ngày". */
const STATUS_CODE: Record<AttendanceDayDto['status'], string> = {
  RETENTION_EXPIRED: 'Hết hạn lưu',
  NOT_EMPLOYED: '',
  HOLIDAY: 'L',
  OFF: '',
  ON_LEAVE: 'P',
  PRESENT: 'X',
  MISSING_OUT: 'Thiếu ra',
  ABSENT: 'V',
  PENDING: '',
};

/**
 * Bảng công tháng .xlsx (hr-extended ADR-130, T-056) — 3 sheet (XL-01): "Tổng hợp" (một dòng / người, tổng do server tính
 * bằng `totalsOf` — XL-02), "Theo ngày" (ma trận người × ngày, ký hiệu), "Giờ vào – ra" (một dòng / người × ngày như CSV).
 * Mỗi sheet đọc lại theo lô `batchSize` người (số truy vấn cố định / lô, không N+1) — gọi TRONG một transaction snapshot
 * để ba sheet khớp nhau (XL-07). Không IP / UA, không lý do nghỉ / ghi chú, không SĐT (ADR-130). Người đã nghỉ có nhãn.
 */
export function attendanceMonthSheets(
  d: AttendanceDeps,
  q: { roster: readonly RosterEntry[]; from: LocalDate; to: LocalDate; today: LocalDate },
  pacing: ReportPacing,
): ReportSheet[] {
  const n = daysBetween(q.from, q.to) + 1;
  const dates = Array.from(
    { length: n },
    (_, i) => `${q.from.slice(0, 8)}${String(i + 1).padStart(2, '0')}`,
  );

  async function* batches() {
    for (let i = 0; i < q.roster.length; i += pacing.batchSize) {
      if (i > 0 && pacing.batchDelayMs > 0) await pacing.sleep(pacing.batchDelayMs);
      const batch = q.roster.slice(i, i + pacing.batchSize);
      const days = await summarizeUsers(d, {
        userIds: batch.map((r) => r.user.id),
        from: q.from,
        to: q.to,
      });
      yield batch.map((r) => ({ entry: r, days: days.get(r.user.id) ?? [] }));
    }
  }
  const status = (r: RosterEntry) => (r.left ? 'Đã nghỉ' : 'Đang làm');

  return [
    {
      name: 'Tổng hợp',
      columns: [
        { header: 'Họ tên', width: 28 },
        { header: 'Trạng thái', width: 12 },
        { header: 'Ngày có đi làm' },
        { header: 'Thiếu giờ ra (ngày)' },
        { header: 'Vắng (ngày)' },
        { header: 'Nghỉ phép (ngày)' },
        { header: 'Đi muộn (lần)' },
        { header: 'Đi muộn (phút)' },
        { header: 'Về sớm (lần)' },
        { header: 'Về sớm (phút)' },
        { header: 'Giờ làm (phút)' },
      ],
      rows: (async function* () {
        for await (const batch of batches()) {
          for (const { entry, days } of batch) {
            const t = totalsOf(days, q.today);
            yield [
              entry.user.fullName,
              status(entry),
              t.presentDays,
              t.missingOutDays,
              t.absentDays,
              t.leaveDays,
              t.lateDays,
              t.lateMin,
              t.earlyDays,
              t.earlyMin,
              t.workedMin,
            ];
          }
        }
      })(),
    },
    {
      name: 'Theo ngày',
      columns: [
        { header: 'Họ tên', width: 28 },
        { header: 'Trạng thái', width: 12 },
        ...dates.map((date) => ({
          header: `${date.slice(8)} ${WEEKDAY[weekdayOf(date)]!}`,
          width: 9,
        })),
      ],
      rows: (async function* () {
        for await (const batch of batches()) {
          for (const { entry, days } of batch) {
            const byDate = new Map(days.map((day) => [day.date, day]));
            yield [
              entry.user.fullName,
              status(entry),
              ...dates.map((date) => {
                const day = byDate.get(date);
                return day ? STATUS_CODE[day.status] || null : null;
              }),
            ];
          }
        }
      })(),
    },
    {
      name: 'Giờ vào – ra',
      columns: [
        { header: 'Họ tên', width: 28 },
        { header: 'Đã nghỉ việc' },
        { header: 'Ngày', width: 12 },
        { header: 'Thứ' },
        { header: 'Trạng thái', width: 16 },
        { header: 'Giờ vào' },
        { header: 'Giờ ra', width: 11 },
        { header: 'Phút làm' },
        { header: 'Đi muộn (phút)' },
        { header: 'Về sớm (phút)' },
        { header: 'Nghỉ phép', width: 12 },
        { header: 'Ngày lễ', width: 20 },
      ],
      rows: (async function* () {
        for await (const batch of batches()) {
          for (const { entry, days } of batch) {
            for (const day of days) {
              yield [
                entry.user.fullName,
                entry.left ? 'Có' : null,
                xlsxDate(day.date),
                WEEKDAY[weekdayOf(day.date)]!,
                STATUS_LABEL[day.status],
                clock(day.firstIn, day) || null,
                clock(day.lastOut, day) || null,
                day.workedMin,
                day.lateMin,
                day.earlyMin,
                day.leave ? LEAVE_LABEL[day.leave] : null,
                day.holidayName,
              ];
            }
          }
        }
      })(),
    },
  ];
}
