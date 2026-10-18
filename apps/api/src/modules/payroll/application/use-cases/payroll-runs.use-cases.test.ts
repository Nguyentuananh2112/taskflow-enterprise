import { describe, expect, it } from 'vitest';

import { createPayrollHarness, KAI, MAX, MIA, OLIVIA } from '../../testing/payroll-harness';
import { PayrollRunsUseCases } from './payroll-runs.use-cases';
import { PublishPayrollUseCase } from './publish-payroll.use-case';

// payroll.md §7 RD / PE / SN (T-049) tầng A: tạo nháp, tính lại, thêm người, phát hành (PUBLISH_BLOCKED đủ lý do).
type H = ReturnType<typeof createPayrollHarness>;

async function ready(h: H) {
  await h.profile(KAI, '2026-01', 12_000_000);
  await h.profile(MIA, '2026-01', 10_000_000);
  const runs = new PayrollRunsUseCases(h.deps);
  const publish = new PublishPayrollUseCase(h.deps);
  return Object.assign(runs, {
    publish: (actorId: string, period: string) => publish.execute(actorId, period),
  });
}
const current = async (h: H, period: string) => {
  const run = (await h.store.findRun(period))!;
  return { run, payslips: await h.store.listCurrentPayslips(run.id) };
};
const blocked = (err: unknown) => (err as { details: { rule: string; blockers: unknown } }).details;

describe('tạo nháp', () => {
  it('tháng chưa kết thúc ⇒ 422 PERIOD_NOT_ENDED; nhân viên thường ⇒ 403', async () => {
    const h = createPayrollHarness();
    const runs = await ready(h);
    await expect(runs.create(KAI, '2026-12')).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'PERIOD_NOT_ENDED' },
    });
    await expect(runs.create(MIA, '2026-11')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('người trong kỳ ⇒ một phiếu / người, ảnh chụp S + mức thâm niên; Mia 3 năm tròn ⇒ 1.500.000; khóa kỳ; audit; lần 2 trả bảng cũ', async () => {
    const h = createPayrollHarness();
    const runs = await ready(h);
    const first = await runs.create(KAI, '2026-11');
    expect(first.created).toBe(true);
    const { run, payslips } = await current(h, '2026-11');
    expect(run).toMatchObject({ status: 'DRAFT', standardDays: 25, seniorityPerYear: 500_000 });
    expect(payslips.map((p) => p.userId).sort()).toEqual([KAI, MIA, MAX].sort());
    expect(payslips.find((p) => p.userId === MIA)).toMatchObject({
      fullName: 'Mia',
      baseSalary: 10_000_000,
      seniorityYears: 3,
      seniorityAllowance: 1_500_000,
      salaryByDays: 10_000_000,
      netPay: 11_500_000,
      revision: 1,
      lockVersion: 1,
    });
    expect(h.store.locks).toEqual(['taskflow:payroll:2026-11']);
    expect(h.audit.map((a) => a.action)).toEqual(['PAYROLL_RUN_CREATE']);
    expect((await runs.create(OLIVIA, '2026-11')).created).toBe(false);
    expect((await current(h, '2026-11')).payslips).toHaveLength(3);
  });

  it('kỳ không có ngày làm ⇒ 422 NO_WORKING_DAYS; ngày quá hạn lưu ⇒ 422 ATTENDANCE_RETENTION_EXPIRED; không tạo gì', async () => {
    const h = createPayrollHarness();
    const runs = await ready(h);
    h.att.noWorkdays = true;
    await expect(runs.create(KAI, '2026-11')).rejects.toMatchObject({
      details: { rule: 'NO_WORKING_DAYS' },
    });
    h.att.noWorkdays = false;
    h.days.set(MIA, { ok: false, reason: 'ATTENDANCE_RETENTION_EXPIRED' });
    await expect(runs.create(KAI, '2026-11')).rejects.toMatchObject({
      details: { rule: 'ATTENDANCE_RETENTION_EXPIRED' },
    });
    expect(await h.store.findRun('2026-11')).toBeNull();
  });
});

describe('phát hành', () => {
  it('RD-04 chặn ⇒ 422 PUBLISH_BLOCKED liệt kê ĐỦ phiếu + mọi lý do (Max thiếu hồ sơ + thiếu hireDate); không phát hành', async () => {
    const h = createPayrollHarness();
    const runs = await ready(h);
    await runs.create(KAI, '2026-11');
    const err: unknown = await runs.publish(KAI, '2026-11').catch((e: unknown) => e);
    expect(blocked(err)).toEqual({
      rule: 'PUBLISH_BLOCKED',
      blockers: [{ userId: MAX, reasons: ['MISSING_SALARY_PROFILE', 'MISSING_HIRE_DATE'] }],
    });
    expect((await h.store.findRun('2026-11'))!.status).toBe('DRAFT');
    expect(h.sent).toEqual([]);
  });

  it('sửa hồ sơ sau khi tạo nháp ⇒ còn chặn HIRE_DATE_CHANGED (cần tính lại); tính lại ⇒ phát hành: ảnh chụp tên công ty, thông báo từng người, lần 2 ⇒ 409', async () => {
    const h = createPayrollHarness();
    const runs = await ready(h);
    await runs.create(KAI, '2026-11');
    await h.profile(MAX, '2026-11', 8_000_000);
    h.hireDates.set(MAX, '2026-03-01');
    const err: unknown = await runs.publish(KAI, '2026-11').catch((e: unknown) => e);
    expect(blocked(err).blockers).toEqual([
      {
        userId: MAX,
        reasons: ['MISSING_SALARY_PROFILE', 'MISSING_HIRE_DATE', 'HIRE_DATE_CHANGED'],
      },
    ]);
    expect((await runs.previewRecalculate(KAI, '2026-11')).changedCount).toBe(1);
    expect((await runs.recalculate(KAI, '2026-11')).changedCount).toBe(1);
    await runs.publish(KAI, '2026-11');
    const { run, payslips } = await current(h, '2026-11');
    expect(run).toMatchObject({
      status: 'PUBLISHED',
      companyName: 'Công ty Bịa',
      publishedById: KAI,
    });
    expect(h.sent.map((s) => [s.type, s.recipient])).toEqual(
      payslips.map((p) => ['PAYSLIP_PUBLISHED', { kind: 'user', userId: p.userId }]),
    );
    await expect(runs.publish(KAI, '2026-11')).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'invalid_transition' },
    });
  });

  it('đổi mức thâm niên khi NHÁP ⇒ nháp giữ số cũ + chặn SENIORITY_RATE_CHANGED cho mọi phiếu tới khi tính lại', async () => {
    const h = createPayrollHarness();
    const runs = await ready(h);
    h.hireDates.set(MAX, '2025-01-01');
    await h.profile(MAX, '2026-01', 8_000_000);
    await runs.create(KAI, '2026-11');
    await h.store.updateSettings({
      seniorityPerYear: 600_000,
      expectedVersion: 1,
      updatedById: OLIVIA,
      at: new Date(),
    });
    const err: unknown = await runs.publish(KAI, '2026-11').catch((e: unknown) => e);
    expect(blocked(err).blockers).toEqual(
      [KAI, MAX, MIA].sort().map((userId) => ({ userId, reasons: ['SENIORITY_RATE_CHANGED'] })),
    );
    await runs.recalculate(KAI, '2026-11');
    const mia = (await current(h, '2026-11')).payslips.find((p) => p.userId === MIA)!;
    expect(mia.seniorityAllowance).toBe(1_800_000);
    await runs.publish(KAI, '2026-11');
  });
});

describe('thêm người còn thiếu', () => {
  it('người mới có đoạn EMPLOYEE giao kỳ ⇒ thêm đúng một phiếu; lần 2 ⇒ 0', async () => {
    const h = createPayrollHarness();
    const runs = await ready(h);
    await runs.create(KAI, '2026-11');
    h.members.push(OLIVIA); // vd Admin từng là nhân viên tới ngày 15
    expect((await runs.addMissing(KAI, '2026-11')).added).toBe(1);
    expect((await runs.addMissing(KAI, '2026-11')).added).toBe(0);
    expect((await current(h, '2026-11')).payslips).toHaveLength(4);
  });
});
