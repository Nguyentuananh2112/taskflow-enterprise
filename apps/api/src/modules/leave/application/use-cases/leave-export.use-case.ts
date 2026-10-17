import type { ExportLimits } from '../../../../core/export/export-limits';
import type { ExportSlots } from '../../../../core/export/export-slots';
import {
  xlsxDate,
  type CellValue,
  type SpreadsheetSheet,
} from '../../../../core/export/xlsx/xlsx-writer';
import { BusinessRuleViolationError } from '../../../../core/errors';
import type { IReadSnapshot } from '../../../../core/persistence/read-snapshot';
import { halfDaysToDecimal } from '../../domain/leave-balance';
import { countLeaveHalfDays } from '../../domain/leave-days';
import { latestTenure } from '../balance-prefetch';
import { yearOf, type LeaveKit } from '../leave-kit';
import type { BalanceView } from '../annual-balance';
import type { ILeaveEmployeeDirectory, ILeaveReadModel } from '../ports/leave-read-model.port';

// GET leave/export.xlsx (T-057, ADR-130/131; B review): báo cáo phép một năm — sheet 1 số dư phân rã của nhân viên
// hiện tại, sheet 2 đơn ĐÃ DUYỆT trong [from, to]. KHÔNG có lý do nghỉ (B-H2). Thứ tự (chung với các export khác):
//   1. chốt quyền hr:manage (uow.run ngắn — FOR SHARE không chạy được trong transaction READ ONLY);
//   2. suất export đồng thời (ExportSlots) — hết ⇒ 429, không audit;
//   3. MỘT snapshot REPEATABLE READ READ ONLY bao trọn: đếm (⇒ 422 EXPORT_TOO_LARGE, không audit) → audit EXPORT
//      (`snapshot.outside` + uow.run riêng — audit đã commit mà stream lỗi vẫn ghi "đã xuất", ADR-130) → gửi header →
//      stream theo lô `batchSize`, trễ `batchDelayMs` giữa hai lô (test);
//   4. nhả suất trong `finally` (kể cả client hủy giữa chừng).

const TYPE_LABEL: Record<string, string> = {
  ANNUAL: 'Phép năm',
  SICK: 'Nghỉ ốm',
  PERSONAL_PAID: 'Việc riêng có lương',
  UNPAID: 'Không lương',
  OTHER: 'Khác',
};
const PART_LABEL: Record<string, string> = { FULL: 'Cả ngày', AM: 'Buổi sáng', PM: 'Buổi chiều' };
/** Trần thời gian của snapshot báo cáo (≤ READ_SNAPSHOT_MAX_MS). */
const SNAPSHOT_TIMEOUT_MS = 120_000;

type Person = { id: string; fullName: string };

export class LeaveExportUseCase {
  constructor(
    private readonly kit: LeaveKit,
    private readonly readModel: ILeaveReadModel,
    private readonly employees: ILeaveEmployeeDirectory,
    private readonly x: {
      snapshot: IReadSnapshot;
      slots: ExportSlots;
      /** Trần / nhịp đọc dùng chung (T-055 `config.exportLimits`). */
      limits: ExportLimits;
    },
  ) {}

  async run(
    actorId: string,
    q: { year: number; from?: string | undefined; to?: string | undefined },
    deliver: (sheets: SpreadsheetSheet[]) => Promise<void>,
  ): Promise<void> {
    const d = this.kit.d;
    const from = q.from ?? `${String(q.year)}-01-01`;
    const to = q.to ?? `${String(q.year)}-12-31`;
    await d.uow.run(() =>
      d.company.authorizeHrWrite({ actorId, targetUserId: null, reason: null }),
    );
    const release = this.x.slots.acquire();
    try {
      await this.x.snapshot.run(
        async () => {
          const people = await this.allEmployees();
          const approved = await this.readModel.listApproved({ from, to });
          const { maxEmployees, maxLeaveRows } = this.x.limits;
          if (people.length > maxEmployees || approved.length > maxLeaveRows) {
            throw new BusinessRuleViolationError(
              'EXPORT_TOO_LARGE',
              'Báo cáo quá lớn — hãy thu hẹp khoảng ngày.',
              { maxEmployees, maxLeaveRows },
            );
          }
          await this.x.snapshot.outside(() =>
            d.uow.run(() =>
              d.audit.record({
                actorId,
                action: 'EXPORT',
                targetUserId: null,
                refId: null,
                before: null,
                // ADR-130 (hr-extended §4, XL-10): cùng dạng với ATTENDANCE_MONTH; `rows` = số dòng dữ liệu của cả hai sheet.
                after: {
                  report: 'LEAVE_YEAR',
                  period: String(q.year),
                  from,
                  to,
                  rows: people.length + approved.length,
                  format: 'xlsx',
                },
              }),
            ),
          );
          await deliver([
            {
              name: `Số dư ${String(q.year)}`,
              columns: [
                { header: 'Nhân viên', width: 28 },
                { header: 'Phép năm', width: 10 },
                { header: 'Trong đó thâm niên', width: 10 },
                { header: 'Điều chỉnh', width: 11 },
                { header: 'Năm trước chuyển sang', width: 12 },
                { header: 'Hạn dùng phép chuyển sang', width: 14 },
                { header: 'Đã dùng', width: 9 },
                { header: 'Đang chờ', width: 9 },
                { header: 'Còn lại', width: 9 },
                { header: 'Ghi chú', width: 26 },
              ],
              rows: this.balanceRows(people, q.year),
            },
            {
              name: 'Đơn đã duyệt',
              columns: [
                { header: 'Nhân viên', width: 28 },
                { header: 'Loại', width: 18 },
                { header: 'Từ ngày', width: 12 },
                { header: 'Đến ngày', width: 12 },
                { header: 'Buổi', width: 11 },
                { header: 'Số ngày', width: 9 },
              ],
              rows: this.approvedRows(approved),
            },
          ]);
        },
        { timeoutMs: SNAPSHOT_TIMEOUT_MS },
      );
    } finally {
      release();
    }
  }

  private async allEmployees(): Promise<Person[]> {
    const out: Person[] = [];
    let after: Person | null = null;
    for (;;) {
      const page = await this.employees.listEmployees(after, this.x.limits.batchSize);
      out.push(...page);
      if (page.length < this.x.limits.batchSize) return out;
      after = page.at(-1)!;
    }
  }

  /** Trễ giữa hai lô (chỉ test — giữ export "đang chạy" cho SEC-HR-54 / XL-07). */
  private async pause(i: number): Promise<void> {
    if (i > 0 && i % this.x.limits.batchSize === 0 && this.x.limits.batchDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.x.limits.batchDelayMs));
    }
  }

  /**
   * T-057d: theo LÔ `batchSize` — mỗi lô một truy vấn nhiệm kỳ + bộ tính nạp sẵn (ngày vào, số dư, đơn, năm trước) ⇒
   * số truy vấn theo số LÔ, không theo số người. Nhiệm kỳ chọn như trang số dư (`latestTenure`).
   */
  private async *balanceRows(people: readonly Person[], year: number): AsyncGenerator<CellValue[]> {
    const today = await this.kit.today();
    const size = this.x.limits.batchSize;
    for (let i = 0; i < people.length; i += size) {
      await this.pause(i);
      const batch = people.slice(i, i + size);
      const userIds = batch.map((p) => p.id);
      const [calc, tenures] = await Promise.all([
        this.kit.readCalculatorFor(this.readModel, { userIds, year, currentYearLoaded: false }),
        this.kit.d.company.tenuresOf({
          userIds,
          from: `${String(year)}-01-01`,
          to: `${String(year)}-12-31`,
        }),
      ]);
      for (const user of batch) {
        const v = await calc.compute({
          userId: user.id,
          year,
          today,
          tenure: latestTenure(tenures.get(user.id)),
        });
        yield balanceRow(user, v);
      }
    }
  }

  private async *approvedRows(
    rows: readonly Awaited<ReturnType<ILeaveReadModel['listApproved']>>[number][],
  ): AsyncGenerator<CellValue[]> {
    const calc = this.kit.readCalculator(this.readModel); // lịch năm cache một lần
    const size = this.x.limits.batchSize;
    for (let i = 0; i < rows.length; i += size) {
      await this.pause(i);
      const batch = rows.slice(i, i + size);
      const refs = await this.kit.d.users.findRefs([...new Set(batch.map((r) => r.userId))]);
      for (const r of batch) {
        const calendar = await calc.calendar(yearOf(r.startDate));
        yield [
          refs.get(r.userId)?.fullName ?? r.userId,
          TYPE_LABEL[r.type] ?? r.type,
          xlsxDate(r.startDate),
          xlsxDate(r.endDate),
          PART_LABEL[r.dayPart] ?? r.dayPart,
          halfDaysToDecimal(countLeaveHalfDays(r, calendar)),
        ];
      }
    }
  }
}

function balanceRow(user: Person, v: BalanceView): CellValue[] {
  const n = halfDaysToDecimal;
  const notes = [
    v.entitlement.missingHireDate ? 'Thiếu ngày vào công ty' : null,
    v.carriedFinal ? null : 'Phép chuyển sang tạm tính',
  ].filter(Boolean);
  return [
    user.fullName,
    n(v.entitlement.entitled),
    n(v.entitlement.bonus),
    n(v.adjustment),
    n(v.carried),
    v.expiresOn === null ? null : xlsxDate(v.expiresOn),
    n(v.used),
    n(v.pending),
    n(v.balance.remaining),
    notes.length > 0 ? notes.join('; ') : null,
  ];
}
