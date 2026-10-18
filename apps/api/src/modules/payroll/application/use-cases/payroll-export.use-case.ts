import { payrollExportFileName } from '@taskflow/contracts/payroll';

import { BusinessRuleViolationError, ResourceNotFoundError } from '../../../../core/errors';
import type { ExportLimits } from '../../../../core/export/export-limits';
import type { ExportSlots } from '../../../../core/export/export-slots';
import {
  xlsxDate,
  type CellValue,
  type SpreadsheetSheet,
} from '../../../../core/export/xlsx/xlsx-writer';
import type { IReadSnapshot } from '../../../../core/persistence/read-snapshot';
import type { PayrollDeps } from '../payroll-kit';
import type { PayslipRecord, PayslipSection } from '../ports/payroll-store.port';

export interface PayrollExportDeps extends PayrollDeps {
  snapshot: IReadSnapshot;
  slots: Pick<ExportSlots, 'acquire'>;
  /** Trần / nhịp đọc dùng chung (T-055 `config.exportLimits`) — trần người = `maxEmployees`. */
  limits: ExportLimits;
}

/** Trần thời gian của snapshot báo cáo (≤ READ_SNAPSHOT_MAX_MS). */
const SNAPSHOT_TIMEOUT_MS = 120_000;

const SECTION_LABEL: Record<PayslipSection, string> = {
  INCOME: 'Thu nhập',
  BONUS: 'Thưởng',
  DEDUCTION: 'Giảm trừ',
};

/** Nửa ngày công ⇒ số ngày (bước 0,5 — số thực chính xác trong Excel). */
const days = (halfDays: number) => halfDays / 2;

/**
 * `GET payroll/runs/:period/export.xlsx` (payroll.md §5.2 + §6, hr-extended ADR-130; T-049). Thứ tự (chung với các
 * export khác — B chốt): [route: quyền `payroll:manage` → validate → hạn mức EXPORT_RATE_LIMIT] → chốt quyền (uow.run
 * ngắn, FOR SHARE) → suất export đồng thời (ExportSlots — hết ⇒ 429, không audit) → MỘT snapshot REPEATABLE READ READ
 * ONLY: bảng chưa có ⇒ 404 · đếm phiếu > `maxEmployees` ⇒ 422 `EXPORT_TOO_LARGE` (chưa header, không audit) → audit
 * `PAYROLL_EXPORT` (`snapshot.outside` + uow.run riêng — đã commit mà stream lỗi vẫn ghi "đã xuất") → header → stream →
 * nhả suất (`finally`).
 *
 * Nội dung: CHỈ bản hiệu lực + cột "Bản" (revision). Ô tiền là SỐ nguyên đồng (không ₫, không `'`) — đúng các tổng của
 * `computePayslip` đã lưu; nhãn dòng gõ tay là chuỗi nguyên văn (writer tự `quotePrefix` = + - @ TAB CR); không công
 * thức. KHÔNG có lý do sửa công / lý do điều chỉnh (có thể nhắc sức khỏe — như B-H2 của phép).
 */
export class PayrollExportUseCase {
  constructor(private readonly d: PayrollExportDeps) {}

  async run(
    actorId: string,
    period: string,
    send: (filename: string, sheets: readonly SpreadsheetSheet[]) => Promise<void>,
  ): Promise<void> {
    const { d } = this;
    await d.uow.run(() => d.access.authorizeWrite({ actorId }));
    const release = d.slots.acquire();
    try {
      await d.snapshot.run(
        async () => {
          const run = await d.store.findRun(period);
          if (!run) throw new ResourceNotFoundError('payroll_run');
          const slips = (await d.store.listCurrentPayslips(run.id)).sort(
            (a, b) =>
              a.fullName.localeCompare(b.fullName, 'vi') || a.userId.localeCompare(b.userId),
          );
          const { maxEmployees } = d.limits;
          if (slips.length > maxEmployees) {
            throw new BusinessRuleViolationError(
              'EXPORT_TOO_LARGE',
              'Bảng lương quá lớn để xuất một lần.',
              { maxEmployees },
            );
          }
          await d.snapshot.outside(() =>
            d.uow.run(() =>
              d.audit.record({
                actorId,
                action: 'PAYROLL_EXPORT',
                targetUserId: null,
                refId: run.id,
                before: null,
                // ADR-130: cùng dạng với ATTENDANCE_MONTH / LEAVE_YEAR; `rows` = số phiếu (dòng của sheet chính).
                after: {
                  report: 'PAYROLL_MONTH',
                  period,
                  status: run.status,
                  rows: slips.length,
                  format: 'xlsx',
                },
              }),
            ),
          );
          const draft = run.status === 'DRAFT' ? ' (nháp)' : '';
          await send(payrollExportFileName(period), [
            {
              name: `Bảng lương ${period}${draft}`,
              columns: [
                { header: 'Nhân viên', width: 28 },
                { header: 'Bậc', width: 10 },
                { header: 'Ngày vào công ty', width: 14 },
                { header: 'Số năm thâm niên', width: 10 },
                { header: 'Lương cơ bản', width: 14 },
                { header: 'Công chuẩn', width: 9 },
                { header: 'Công hưởng lương', width: 10 },
                { header: 'Lương theo công', width: 14 },
                { header: 'Phụ cấp thâm niên', width: 14 },
                { header: 'Tổng thu nhập', width: 14 },
                { header: 'Thưởng', width: 13 },
                { header: 'Giảm trừ', width: 13 },
                { header: 'Thực lĩnh', width: 14 },
                { header: 'Bản', width: 6 },
                { header: 'Có ngày nghỉ ốm', width: 9 },
                { header: 'Ghi chú', width: 30 },
              ],
              rows: this.payslipRows(slips, run.standardDays),
            },
            {
              name: 'Các khoản',
              columns: [
                { header: 'Nhân viên', width: 28 },
                { header: 'Loại', width: 11 },
                { header: 'Nội dung', width: 36 },
                { header: 'Số tiền', width: 14 },
              ],
              rows: this.lineRows(slips),
            },
          ]);
        },
        { timeoutMs: SNAPSHOT_TIMEOUT_MS },
      );
    } finally {
      release();
    }
  }

  /** Trễ giữa hai lô (chỉ test — giữ export "đang chạy" cho SEC-HR-54 / XL-07). */
  private async pause(i: number): Promise<void> {
    const { batchSize, batchDelayMs } = this.d.limits;
    if (i > 0 && i % batchSize === 0 && batchDelayMs > 0) {
      await new Promise((r) => setTimeout(r, batchDelayMs));
    }
  }

  private async *payslipRows(
    slips: readonly PayslipRecord[],
    standardDays: number,
  ): AsyncGenerator<CellValue[]> {
    for (const [i, p] of slips.entries()) {
      await this.pause(i);
      yield [
        p.fullName,
        p.level,
        p.hireDate === null ? null : xlsxDate(p.hireDate),
        p.seniorityYears,
        p.baseSalary,
        standardDays,
        days(p.overrideHalfDays ?? p.paidHalfDays),
        p.salaryByDays,
        p.seniorityAllowance,
        p.incomeTotal,
        p.bonusTotal,
        p.deductionTotal,
        p.netPay,
        p.revision,
        p.hasSickDays ? 'Có' : null,
        p.note,
      ];
    }
  }

  private async *lineRows(slips: readonly PayslipRecord[]): AsyncGenerator<CellValue[]> {
    for (const [i, p] of slips.entries()) {
      await this.pause(i);
      for (const l of p.lines) yield [p.fullName, SECTION_LABEL[l.section], l.label, l.amount];
    }
  }
}
