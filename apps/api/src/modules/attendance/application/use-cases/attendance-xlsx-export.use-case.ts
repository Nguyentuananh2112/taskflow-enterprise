import { attendanceExportFileName } from '@taskflow/contracts';

import { BusinessRuleViolationError } from '../../../../core/errors';
import type { ExportLimits } from '../../../../core/export/export-limits';
import type { ExportSlots } from '../../../../core/export/export-slots';
import type { IReadSnapshot } from '../../../../core/persistence/read-snapshot';
import { localToday } from '../../domain/work-schedule';
import { lastDayOf } from '../attendance-days';
import { attendanceMonthSheets, type ReportSheet } from '../attendance-month-report';
import type { AttendanceExportDeps } from './attendance-export.use-case';
import { HrAttendanceQueries } from './hr-attendance.queries';

export interface AttendanceXlsxDeps extends AttendanceExportDeps {
  snapshot: IReadSnapshot;
  slots: Pick<ExportSlots, 'acquire'>;
  limits: ExportLimits;
  sleep: (ms: number) => Promise<void>;
}

/** Trần thời gian mỗi snapshot đọc (ms) — hr-extended §4 "statement_timeout 30s" áp cho cả lượt đếm lẫn lượt stream. */
const SNAPSHOT_MS = 120_000;

/**
 * `GET attendance/export.xlsx?month=` (hr-extended ADR-130, T-056). Thứ tự (B/D chốt, khớp test F): [route: quyền →
 * validate → hạn mức chung CSV] → tháng chưa bắt đầu ⇒ 422 `PERIOD_NOT_STARTED` → đọc lại quyền (uow.run ngắn) → giữ
 * suất export (lượt thứ 3 cả công ty ⇒ 429) → MỘT snapshot đọc: đếm người, quá `maxEmployees` ⇒ 422 `EXPORT_TOO_LARGE`
 * (chưa header, không audit) → `snapshot.outside(uow.run)`: audit `EXPORT` → `send` (header + stream theo lô) → nhả suất
 * (finally).
 */
export class AttendanceXlsxExportUseCase {
  readonly #hr: HrAttendanceQueries;
  constructor(private readonly d: AttendanceXlsxDeps) {
    this.#hr = new HrAttendanceQueries(d);
  }

  async run(
    actorId: string,
    month: string,
    send: (filename: string, sheets: readonly ReportSheet[]) => Promise<void>,
  ): Promise<void> {
    const { d } = this;
    const today = localToday(await d.calendar.scheduleVersions(), d.clock.now()).date;
    if (month > today.slice(0, 7)) {
      throw new BusinessRuleViolationError('PERIOD_NOT_STARTED', 'Tháng này chưa bắt đầu.');
    }
    const from = `${month}-01`;
    const to = lastDayOf(month);
    // Chốt quyền (đọc lại FOR SHARE) bằng một uow.run ngắn TRƯỚC khi giữ suất / mở snapshot — như báo cáo phép (D).
    await d.uow.run(() => d.company.authorizeWrite({ actorId }));
    const release = d.slots.acquire();
    try {
      // MỘT snapshot cho cả đếm lẫn dữ liệu xuất ⇒ con số 422 và file khớp nhau (XL-07); audit chạy NGOÀI snapshot
      // (`outside` — commit ở kết nối khác, snapshot vẫn mở) trước khi gửi header.
      await d.snapshot.run(
        async () => {
          const roster = await this.#hr.roster(from, to);
          if (roster.length > d.limits.maxEmployees) {
            throw new BusinessRuleViolationError(
              'EXPORT_TOO_LARGE',
              `Báo cáo quá lớn (${String(roster.length)} người, tối đa ${String(d.limits.maxEmployees)}).`,
            );
          }
          await d.snapshot.outside(() =>
            d.uow.run(async () => {
              await d.audit.record({
                actorId,
                action: 'EXPORT',
                after: {
                  report: 'ATTENDANCE_MONTH',
                  period: month,
                  rows: roster.length,
                  format: 'xlsx',
                },
              });
            }),
          );
          const sheets = attendanceMonthSheets(
            d,
            { roster, from, to, today },
            { batchSize: d.limits.batchSize, batchDelayMs: d.limits.batchDelayMs, sleep: d.sleep },
          );
          await send(attendanceExportFileName(month), sheets);
        },
        { timeoutMs: SNAPSHOT_MS },
      );
    } finally {
      release();
    }
  }
}
