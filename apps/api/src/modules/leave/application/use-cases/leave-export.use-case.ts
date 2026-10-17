import type { CellValue, SpreadsheetSheet } from '../../../../core/export/xlsx/xlsx-writer';
import { halfDaysToDecimal } from '../../domain/leave-balance';
import { countLeaveHalfDays } from '../../domain/leave-days';
import { countingTenure, yearOf, type LeaveKit } from '../leave-kit';
import type { ILeaveEmployeeDirectory, ILeaveReadModel } from '../ports/leave-read-model.port';

// GET leave/export.xlsx (T-057, ADR-130/131): báo cáo phép một năm — sheet 1 số dư phân rã của nhân viên hiện tại,
// sheet 2 đơn ĐÃ DUYỆT trong [from, to]. KHÔNG có lý do nghỉ (B-H2). Quyền + audit EXPORT xong TRƯỚC khi gửi header
// (lỗi lúc đó vẫn là envelope JSON); dữ liệu đọc theo lô trong async generator khi stream (B: generator đóng gọn khi
// writer dừng giữa chừng).

const TYPE_LABEL: Record<string, string> = {
  ANNUAL: 'Phép năm',
  SICK: 'Nghỉ ốm',
  PERSONAL_PAID: 'Việc riêng có lương',
  UNPAID: 'Không lương',
  OTHER: 'Khác',
};
const PART_LABEL: Record<string, string> = { FULL: 'Cả ngày', AM: 'Buổi sáng', PM: 'Buổi chiều' };
const BATCH = 50;

export class LeaveExportUseCase {
  constructor(
    private readonly kit: LeaveKit,
    private readonly readModel: ILeaveReadModel,
    private readonly employees: ILeaveEmployeeDirectory,
  ) {}

  async start(
    actorId: string,
    q: { year: number; from?: string | undefined; to?: string | undefined },
  ): Promise<{ year: number; sheets: SpreadsheetSheet[] }> {
    const d = this.kit.d;
    const from = q.from ?? `${String(q.year)}-01-01`;
    const to = q.to ?? `${String(q.year)}-12-31`;
    let people: { id: string; fullName: string }[] = [];
    await d.uow.run(async () => {
      // B-H3: chốt quyền dưới khóa FOR SHARE dòng của actor; audit trong cùng transaction.
      await d.company.authorizeHrWrite({ actorId, targetUserId: null, reason: null });
      people = await this.allEmployees();
      await d.audit.record({
        actorId,
        action: 'EXPORT',
        targetUserId: null,
        refId: null,
        before: null,
        after: { kind: 'leave_year', year: q.year, from, to, employees: people.length },
      });
    });
    return {
      year: q.year,
      sheets: [
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
          rows: this.approvedRows(from, to),
        },
      ],
    };
  }

  private async allEmployees(): Promise<{ id: string; fullName: string }[]> {
    const out: { id: string; fullName: string }[] = [];
    let after: { id: string; fullName: string } | null = null;
    for (;;) {
      const page = await this.employees.listEmployees(after, 500);
      out.push(...page);
      if (page.length < 500) return out;
      after = page.at(-1)!;
    }
  }

  private async *balanceRows(
    people: readonly { id: string; fullName: string }[],
    year: number,
  ): AsyncGenerator<CellValue[]> {
    const calc = this.kit.readCalculator(this.readModel);
    const today = await this.kit.today();
    for (const user of people) {
      const v = await calc.compute({
        userId: user.id,
        year,
        today,
        tenure: countingTenure(await this.kit.d.company.employmentOf(user.id)),
      });
      const n = halfDaysToDecimal;
      yield [
        user.fullName,
        n(v.entitlement.entitled),
        n(v.entitlement.bonus),
        n(v.adjustment),
        n(v.carried),
        v.expiresOn,
        n(v.used),
        n(v.pending),
        n(v.balance.remaining),
        [
          v.entitlement.missingHireDate ? 'Thiếu ngày vào công ty' : null,
          v.carriedFinal ? null : 'Phép chuyển sang tạm tính',
        ]
          .filter(Boolean)
          .join('; ') || null,
      ];
    }
  }

  private async *approvedRows(from: string, to: string): AsyncGenerator<CellValue[]> {
    const rows = await this.readModel.listApproved({ from, to });
    const calc = this.kit.readCalculator(this.readModel); // lịch năm cache một lần
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const refs = await this.kit.d.users.findRefs([...new Set(batch.map((r) => r.userId))]);
      for (const r of batch) {
        const calendar = await calc.calendar(yearOf(r.startDate));
        yield [
          refs.get(r.userId)?.fullName ?? r.userId,
          TYPE_LABEL[r.type] ?? r.type,
          r.startDate,
          r.endDate,
          PART_LABEL[r.dayPart] ?? r.dayPart,
          halfDaysToDecimal(countLeaveHalfDays(r, calendar)),
        ];
      }
    }
  }
}
