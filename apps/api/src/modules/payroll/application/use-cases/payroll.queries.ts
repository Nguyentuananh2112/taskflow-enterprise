import type {
  MyPayslipDto,
  MyPayslipSummaryDto,
  PayrollRunDto,
  PayrollRunListDto,
  PayrollTodoDto,
  PayslipDto,
} from '@taskflow/contracts/payroll';
import { periodLastDay } from '@taskflow/contracts/payroll';

import { addDays } from '../../../../core/domain/local-time';
import { ResourceNotFoundError } from '../../../../core/errors';
import { payslipDto, refOf } from '../payroll-dto';
import { blockReasonsOf, todayOf, type PayrollDeps } from '../payroll-kit';
import type { PayrollRunRecord } from '../ports/payroll-store.port';

const prevMonth = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 1 ? `${String(y - 1)}-12` : `${String(y)}-${String(m - 1).padStart(2, '0')}`;
};

/**
 * Đọc lương (payroll.md §5, T-049). Kế toán (`payroll:manage` — route đã chốt): danh sách bảng, bảng tháng + việc còn
 * lại, phiếu đầy đủ (audit PAYROLL_PAYSLIP_VIEW). Nhân viên (`payslip:self`): chỉ bản HIỆU LỰC trên bảng PUBLISHED của
 * chính mình; danh sách không có số tiền.
 */
export class PayrollQueries {
  constructor(private readonly d: PayrollDeps) {}

  async runs(): Promise<PayrollRunListDto> {
    const runs = await this.d.store.listRuns();
    const today = await todayOf(this.d);
    const last = prevMonth(today.slice(0, 7)); // tháng gần nhất đã kết thúc
    const next = runs.some((r) => r.period === last)
      ? null
      : { period: last, from: addDays(periodLastDay(last), 1), canCreate: true };
    return {
      runs: runs.map((r) => ({
        period: r.period,
        status: r.status,
        payslipCount: r.payslipCount,
        netTotal: r.netTotal,
        publishedAt: r.publishedAt?.toISOString() ?? null,
      })),
      next,
    };
  }

  async run(viewerId: string, period: string): Promise<PayrollRunDto> {
    const { d } = this;
    const run = await this.#run(period);
    const payslips = await d.store.listCurrentPayslips(run.id);
    const userIds = payslips.map((p) => p.userId);
    const [settings, hireDates, days, refs] = await Promise.all([
      d.store.getSettings(),
      d.hireDates.hireDates({ userIds }),
      d.attendance.payrollDaysFor({ userIds, period }).catch(() => null),
      d.users.findRefs([...userIds, ...(run.publishedById ? [run.publishedById] : [])]),
    ]);
    const recalculable = days !== null && [...days.byUser.values()].every((r) => r.ok);
    const todo: PayrollTodoDto[] = [];
    const rows = payslips.map((p) => {
      const user = refOf(refs, p.userId);
      const current = {
        hireDate: hireDates.get(p.userId) ?? null,
        seniorityPerYear: settings.seniorityPerYear,
      };
      const blockReasons = blockReasonsOf(run, p, current);
      for (const kind of new Set(blockReasons)) {
        if (kind !== 'NEGATIVE_NET_PAY') todo.push({ kind, user, date: null });
      }
      const att = days?.byUser.get(p.userId);
      if (run.status === 'DRAFT' && att?.ok) {
        for (const date of att.missingOutDates) todo.push({ kind: 'MISSING_OUT', user, date });
      }
      if (run.status === 'PUBLISHED') {
        if (att?.ok && att.halfDays !== p.paidHalfDays) {
          todo.push({ kind: 'ATTENDANCE_CHANGED_AFTER_PUBLISH', user, date: null });
        }
        if (current.hireDate !== p.hireDate) {
          todo.push({ kind: 'PROFILE_CHANGED_AFTER_PUBLISH', user, date: null });
        }
      }
      return {
        user,
        countedHalfDays: Math.min(p.overrideHalfDays ?? p.paidHalfDays, 2 * run.standardDays),
        overridden: p.overrideHalfDays !== null,
        netPay: p.netPay,
        revision: p.revision,
        blockReasons,
        own: p.userId === viewerId,
      };
    });
    return {
      period: run.period,
      status: run.status,
      standardDays: run.standardDays,
      seniorityPerYear: run.seniorityPerYear,
      recalculable,
      publishedAt: run.publishedAt?.toISOString() ?? null,
      publishedBy: run.publishedById ? refOf(refs, run.publishedById) : null,
      todo,
      payslips: rows.sort((a, b) => a.user.fullName.localeCompare(b.user.fullName, 'vi')),
    };
  }

  /** Phiếu đầy đủ cho Kế toán — xem phiếu là dữ liệu nhạy cảm ⇒ audit PAYROLL_PAYSLIP_VIEW. */
  async payslip(viewerId: string, period: string, userId: string): Promise<PayslipDto> {
    const { d } = this;
    const run = await this.#run(period);
    const p = await d.store.findCurrentPayslip(run.id, userId);
    if (!p) throw new ResourceNotFoundError('payslip');
    await d.uow.run(() =>
      d.audit.record({
        actorId: viewerId,
        action: 'PAYROLL_PAYSLIP_VIEW',
        targetUserId: userId,
        refId: p.id,
        after: { period, revision: p.revision },
      }),
    );
    return payslipDto(run, p);
  }

  /** `GET payslips` — chỉ kỳ + bản; không số tiền. */
  async mine(userId: string): Promise<MyPayslipSummaryDto[]> {
    return (await this.d.store.myPayslips(userId)).map((r) => ({
      period: r.period,
      revision: r.revision,
      publishedAt: r.publishedAt.toISOString(),
    }));
  }

  /** `GET payslips/:period[/revisions/:revision]` — chỉ bảng PUBLISHED; không có ⇒ 404 (không lộ nháp). */
  async myPayslip(userId: string, period: string, revision?: number): Promise<MyPayslipDto> {
    const run = await this.d.store.findRun(period);
    if (!run || run.status !== 'PUBLISHED') throw new ResourceNotFoundError('payslip');
    const all = await this.d.store.listRevisions(run.id, userId);
    const p =
      revision === undefined
        ? all.find((x) => x.supersededAt === null)
        : all.find((x) => x.revision === revision);
    if (!p) throw new ResourceNotFoundError('payslip');
    const { lockVersion: _lock, ...dto } = payslipDto(run, p);
    return dto;
  }

  async #run(period: string): Promise<PayrollRunRecord> {
    const run = await this.d.store.findRun(period);
    if (!run) throw new ResourceNotFoundError('payroll_run');
    return run;
  }
}
