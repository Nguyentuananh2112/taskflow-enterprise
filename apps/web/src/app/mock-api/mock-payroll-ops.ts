import type { PayrollTodoDto } from '@taskflow/contracts/payroll';

import type { MockPayroll, MockRun } from './mock-payroll';

// Thao tác cả bảng NHÁP (ADR-127): "Tính lại công" giữ dòng gõ tay + sửa công có lý do, lấy lại công / hồ sơ / mức
// thâm niên hiện hành; "Thêm người còn thiếu" thêm phiếu cho nhân viên chưa có trong bảng.

export function recalculate(payroll: MockPayroll, run: MockRun): void {
  run.seniorityPerYear = payroll.settings.seniorityPerYear;
  for (const [userId, list] of run.slips) {
    const s = list.at(-1);
    if (!s) continue;
    const next = payroll.build(run, s.userRef, {
      lines: s.lines.map(({ section, label, amount }) => ({ section, label, amount })),
      note: s.note,
      overrideHalfDays: s.overrideHalfDays,
      overrideReason: s.overrideReason,
      lockVersion: s.lockVersion + 1,
    });
    run.slips.set(userId, [next]);
  }
}

export function addMissing(payroll: MockPayroll, run: MockRun): void {
  for (const u of payroll.people())
    if (!run.slips.has(u.id)) run.slips.set(u.id, [payroll.build(run, u)]);
}

/** DTO bảng tháng: dòng phiếu (chỉ thực lĩnh), lý do chặn, việc còn lại (§5.2). */
export function runView(payroll: MockPayroll, run: MockRun, actorId: string) {
  const todo: PayrollTodoDto[] = [];
  const payslips = [...run.slips.values()].flatMap((list) => {
    const s = list.at(-1);
    if (!s) return [];
    const reasons = payroll.blockReasons(run, s);
    for (const kind of reasons)
      if (kind !== 'NEGATIVE_NET_PAY' && kind !== 'SENIORITY_RATE_CHANGED')
        todo.push({ kind, user: s.userRef, date: null });
    for (const date of payroll.missingOut(s.userId, run.period))
      todo.push({ kind: 'MISSING_OUT', user: s.userRef, date });
    return [
      {
        user: s.userRef,
        countedHalfDays: Math.min(s.overrideHalfDays ?? s.paidHalfDays, 2 * run.standardDays),
        overridden: s.overrideHalfDays !== null,
        netPay: s.netPay,
        revision: s.revision,
        blockReasons: reasons,
        own: s.userId === actorId,
      },
    ];
  });
  if (run.status === 'DRAFT' && run.seniorityPerYear !== payroll.settings.seniorityPerYear)
    todo.unshift({ kind: 'SENIORITY_RATE_CHANGED', user: null, date: null });
  return {
    period: run.period,
    status: run.status,
    standardDays: run.standardDays,
    seniorityPerYear: run.seniorityPerYear,
    recalculable: true,
    publishedAt: run.publishedAt,
    publishedBy: run.publishedBy,
    todo,
    payslips: payslips.sort((a, b) => a.user.fullName.localeCompare(b.user.fullName, 'vi')),
  };
}
