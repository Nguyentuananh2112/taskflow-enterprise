import {
  BusinessRuleViolationError,
  ResourceConflictError,
  ResourceNotFoundError,
} from '../../../core/errors';
import { draftPayslip, loadSources, type PayrollDeps } from './payroll-kit';
import type { PayrollRunRecord, PayslipRecord } from './ports/payroll-store.port';

/** Bảng NHÁP của kỳ — chưa có ⇒ 404; đã phát hành ⇒ 409 `invalid_transition`. Gọi TRONG khóa kỳ. */
export async function draftRun(d: PayrollDeps, period: string): Promise<PayrollRunRecord> {
  const run = await d.store.findRun(period);
  if (!run) throw new ResourceNotFoundError('payroll_run');
  if (run.status !== 'DRAFT') {
    throw new ResourceConflictError({ reason: 'invalid_transition' }, 'Bảng lương đã phát hành.');
  }
  return run;
}

/** Nguồn dựng phiếu; lịch không có ngày làm nào trong kỳ ⇒ 422 `NO_WORKING_DAYS`. */
export async function sourcesOf(d: PayrollDeps, period: string, userIds: readonly string[]) {
  try {
    return await loadSources(d, period, userIds);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new BusinessRuleViolationError(
        'NO_WORKING_DAYS',
        'Kỳ này không có ngày làm việc nào theo lịch.',
      );
    }
    throw err;
  }
}

/** Phần kế toán đã gõ — "Tính lại công" giữ nguyên (dòng, ghi chú, sửa công có lý do). */
export const keepOf = (p: PayslipRecord) => ({
  id: p.id,
  lines: p.lines,
  note: p.note,
  overrideHalfDays: p.overrideHalfDays,
  overrideReason: p.overrideReason,
  lockVersion: p.lockVersion,
  createdAt: p.createdAt,
});

/** Phiếu mới chưa có gì gõ tay. */
export const freshKeep = (d: Pick<PayrollDeps, 'ids'>, now: Date) => ({
  id: d.ids.next(),
  lines: [],
  note: null,
  overrideHalfDays: null,
  overrideReason: null,
  lockVersion: 1,
  createdAt: now,
});

/** Các số trên phiếu (so "Tính lại công" — không tính lockVersion / thời điểm). */
const numbersKey = (p: PayslipRecord) =>
  JSON.stringify([
    p.fullName,
    p.level,
    p.baseSalary,
    p.hireDate,
    p.seniorityYears,
    p.seniorityAllowance,
    p.paidHalfDays,
    p.salaryByDays,
    p.incomeTotal,
    p.netPay,
    p.hasSickDays,
  ]);

/**
 * "Tính lại công" của bảng NHÁP (preview lẫn áp dụng dùng CHUNG ⇒ preview khớp kết quả áp — RD): công / hồ sơ / hireDate /
 * mức thâm niên hiện hành; phiếu đổi số khi khác bất kỳ con số nào, hoặc công chuẩn của kỳ đổi.
 */
export async function recalculated(d: PayrollDeps, period: string) {
  const run = await draftRun(d, period);
  const payslips = await d.store.listCurrentPayslips(run.id);
  const src = await sourcesOf(
    d,
    period,
    payslips.map((p) => p.userId),
  );
  const settings = await d.store.getSettings();
  const next = {
    ...run,
    standardDays: src.standardDays,
    seniorityPerYear: settings.seniorityPerYear,
  };
  const now = d.clock.now();
  const changed = payslips
    .map((p) => ({ next: draftPayslip(next, p.userId, src, keepOf(p), now), p }))
    .filter((c) => numbersKey(c.next) !== numbersKey(c.p) || run.standardDays !== next.standardDays)
    .map((c) => ({ next: c.next, lockVersion: c.p.lockVersion }));
  return {
    run,
    changed,
    standardDays: next.standardDays,
    seniorityPerYear: next.seniorityPerYear,
  };
}
