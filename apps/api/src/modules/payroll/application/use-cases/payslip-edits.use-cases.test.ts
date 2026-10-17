import { describe, expect, it } from 'vitest';

import { createPayrollHarness, KAI, MAX, MIA, OLIVIA } from '../../testing/payroll-harness';
import { PayrollRunsUseCases } from './payroll-runs.use-cases';
import { PayslipEditsUseCases } from './payslip-edits.use-cases';
import { PublishPayrollUseCase } from './publish-payroll.use-case';

// payroll.md §7 RD (T-049) tầng A: sửa phiếu NHÁP (lockVersion, luật self), bản điều chỉnh PUBLISHED (đếm 1).
const edit = { lines: [], note: null, overrideHalfDays: null, overrideReason: null };

async function draft() {
  const h = createPayrollHarness();
  await h.profile(KAI, '2026-01', 12_000_000);
  await h.profile(MIA, '2026-01', 10_000_000);
  await h.profile(MAX, '2026-01', 8_000_000);
  h.hireDates.set(MAX, '2026-02-01');
  await new PayrollRunsUseCases(h.deps).create(OLIVIA, '2026-11');
  return { h, edits: new PayslipEditsUseCases(h.deps), publish: new PublishPayrollUseCase(h.deps) };
}

describe('sửa phiếu NHÁP', () => {
  it('dòng + sửa công có lý do ⇒ tính lại tổng, lockVersion + 1; audit lý do ở after.note (không khóa reason)', async () => {
    const { h, edits } = await draft();
    const saved = await edits.put(KAI, {
      period: '2026-11',
      userId: MIA,
      expectedLockVersion: 1,
      lines: [
        { section: 'BONUS', label: 'Thưởng kênh A', amount: 2_000_000 },
        { section: 'DEDUCTION', label: 'BHXH', amount: 1_050_000 },
      ],
      note: 'Ghi chú',
      overrideHalfDays: 48,
      overrideReason: 'Quên chấm 1 ngày, đã xác nhận',
    });
    expect(saved).toMatchObject({
      lockVersion: 2,
      salaryByDays: 9_600_000,
      bonusTotal: 2_000_000,
      deductionTotal: 1_050_000,
      netPay: 9_600_000 + 1_500_000 + 2_000_000 - 1_050_000,
    });
    expect(saved.lines.map((l) => l.label)).toEqual(['Thưởng kênh A', 'BHXH']);
    expect(h.audit.at(-1)).toMatchObject({
      action: 'PAYROLL_PAYSLIP_SET',
      after: { note: 'Quên chấm 1 ngày, đã xác nhận' },
    });
  });

  it('lệch lockVersion ⇒ 409 VERSION_CONFLICT; Kế toán sửa phiếu CỦA MÌNH ⇒ 403 (Admin sửa được)', async () => {
    const { edits } = await draft();
    await expect(
      edits.put(KAI, { period: '2026-11', userId: MIA, expectedLockVersion: 9, ...edit }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(
      edits.put(KAI, { period: '2026-11', userId: KAI, expectedLockVersion: 1, ...edit }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      edits.put(OLIVIA, { period: '2026-11', userId: KAI, expectedLockVersion: 1, ...edit }),
    ).resolves.toMatchObject({ lockVersion: 2 });
  });

  it('bảng đã phát hành ⇒ sửa tại chỗ 409 invalid_transition', async () => {
    const { edits, publish } = await draft();
    await publish.execute(OLIVIA, '2026-11');
    await expect(
      edits.put(KAI, { period: '2026-11', userId: MIA, expectedLockVersion: 1, ...edit }),
    ).rejects.toMatchObject({ statusCode: 409, details: { reason: 'invalid_transition' } });
  });
});

describe('bản điều chỉnh (PUBLISHED)', () => {
  it('revision + 1 thay bản hiệu lực; bản cũ chỉ đặt superseded_at; copy công (không tính lại); thông báo PAYSLIP_REVISED', async () => {
    const { h, edits, publish } = await draft();
    await publish.execute(OLIVIA, '2026-11');
    const run = (await h.store.findRun('2026-11'))!;
    const before = (await h.store.findCurrentPayslip(run.id, MIA))!;
    h.days.set(MIA, { ok: true, halfDays: 10, missingOutDates: [], sickDays: 0 }); // chấm công đổi sau phát hành
    const next = await edits.revise(KAI, {
      period: '2026-11',
      userId: MIA,
      expectedRevision: 1,
      reason: 'Bổ sung thưởng tháng 11',
      ...edit,
      lines: [{ section: 'BONUS', label: 'Thưởng', amount: 500_000 }],
    });
    expect(next).toMatchObject({
      revision: 2,
      revisionReason: 'Bổ sung thưởng tháng 11',
      paidHalfDays: before.paidHalfDays,
      netPay: before.netPay + 500_000,
    });
    const all = await h.store.listRevisions(run.id, MIA);
    expect(all.map((p) => [p.revision, p.supersededAt !== null])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(h.sent.at(-1)).toEqual({
      type: 'PAYSLIP_REVISED',
      refId: next.id,
      actorId: KAI,
      recipient: { kind: 'user', userId: MIA },
    });
    expect(h.audit.at(-1)).toMatchObject({
      after: { revision: 2, note: 'Bổ sung thưởng tháng 11' },
    });
  });

  it('expectedRevision lệch ⇒ 409; thực lĩnh âm ⇒ 422 PUBLISH_BLOCKED, không đổi gì; bảng nháp ⇒ 409', async () => {
    const { h, edits, publish } = await draft();
    await expect(
      edits.revise(KAI, {
        period: '2026-11',
        userId: MIA,
        expectedRevision: 1,
        reason: 'x',
        ...edit,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await publish.execute(OLIVIA, '2026-11');
    await expect(
      edits.revise(KAI, {
        period: '2026-11',
        userId: MIA,
        expectedRevision: 2,
        reason: 'x',
        ...edit,
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(
      edits.revise(KAI, {
        period: '2026-11',
        userId: MIA,
        expectedRevision: 1,
        reason: 'x',
        ...edit,
        lines: [{ section: 'DEDUCTION', label: 'Tạm ứng', amount: 999_000_000 }],
      }),
    ).rejects.toMatchObject({
      details: {
        rule: 'PUBLISH_BLOCKED',
        blockers: [{ userId: MIA, reasons: ['NEGATIVE_NET_PAY'] }],
      },
    });
    const run = (await h.store.findRun('2026-11'))!;
    expect((await h.store.listRevisions(run.id, MIA)).map((p) => p.revision)).toEqual([1]);
  });
});
