import {
  MyPayslipDto,
  PayrollRunDto,
  PayrollRunListDto,
  PayrollSettingsDto,
  PayslipDto,
  SalaryProfileDto,
} from '@taskflow/contracts/payroll';
import { describe, expect, it } from 'vitest';

import { createPayrollHarness, KAI, MAX, MIA, OLIVIA } from '../../testing/payroll-harness';
import { PayrollQueries } from './payroll.queries';
import { PayrollRunsUseCases } from './payroll-runs.use-cases';
import { PayslipEditsUseCases } from './payslip-edits.use-cases';
import { PublishPayrollUseCase } from './publish-payroll.use-case';
import { SettingsProfilesUseCases } from './settings-profiles.use-cases';

// payroll.md §5/§7 (T-049) tầng A: cài đặt, hồ sơ lương, đọc bảng / phiếu (kế toán) và "phiếu của tôi" (nhân viên).
function setup() {
  const h = createPayrollHarness();
  const everEmployed = () => Promise.resolve([KAI, MIA, MAX]);
  return {
    h,
    sp: new SettingsProfilesUseCases({ ...h.deps, everEmployed }),
    q: new PayrollQueries(h.deps),
    runs: new PayrollRunsUseCases(h.deps),
    publish: new PublishPayrollUseCase(h.deps),
    edits: new PayslipEditsUseCases(h.deps),
  };
}

describe('cài đặt + hồ sơ lương', () => {
  it('đổi mức thâm niên (version) ⇒ DTO parse được; lệch version ⇒ 409; audit', async () => {
    const { h, sp } = setup();
    const before = await sp.settings();
    expect(PayrollSettingsDto.parse(before)).toEqual(before);
    expect(before).toMatchObject({ seniorityPerYear: 500_000, version: 1, updatedBy: null });
    const after = await sp.putSettings(KAI, { seniorityPerYear: 600_000, expectedVersion: 1 });
    expect(after).toMatchObject({ seniorityPerYear: 600_000, version: 2, updatedBy: { id: KAI } });
    await expect(
      sp.putSettings(KAI, { seniorityPerYear: 1, expectedVersion: 1 }),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    expect(h.audit.map((a) => a.action)).toEqual(['PAYROLL_SETTINGS_SET']);
  });

  it('phiên bản hồ sơ: thêm ⇒ current theo kỳ hiện tại; trùng tháng ⇒ 409; hồ sơ CỦA MÌNH ⇒ 403; hireDate chỉ đọc', async () => {
    const { sp } = setup();
    await sp.createVersion(KAI, {
      userId: MIA,
      effectiveFrom: '2026-01',
      level: 'L1',
      baseSalary: 9_000_000,
    });
    await sp.createVersion(OLIVIA, {
      userId: MIA,
      effectiveFrom: '2026-12',
      level: 'L2',
      baseSalary: 10_000_000,
    });
    await expect(
      sp.createVersion(KAI, { userId: MIA, effectiveFrom: '2026-12', level: 'L3', baseSalary: 1 }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      sp.createVersion(KAI, { userId: KAI, effectiveFrom: '2026-12', level: 'L3', baseSalary: 1 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const list = await sp.profiles();
    for (const row of list) expect(SalaryProfileDto.parse(row)).toEqual(row);
    expect(list.find((r) => r.userId === MIA)).toMatchObject({
      hireDate: '2023-11-30',
      current: { effectiveFrom: '2026-12', baseSalary: 10_000_000 },
      versions: [{ effectiveFrom: '2026-12' }, { effectiveFrom: '2026-01' }],
    });
  });
});

describe('đọc bảng / phiếu (kế toán)', () => {
  it('danh sách: kỳ gần nhất đã kết thúc chưa có bảng ⇒ next canCreate; có rồi ⇒ next null', async () => {
    const { q, runs, h } = setup();
    await h.profile(MIA, '2026-01', 10_000_000);
    const empty = await q.runs();
    expect(PayrollRunListDto.parse(empty)).toEqual(empty);
    expect(empty.next).toEqual({ period: '2026-11', from: '2026-12-01', canCreate: true });
    await runs.create(KAI, '2026-11');
    expect((await q.runs()).next).toBeNull();
  });

  it('bảng tháng: dòng + blockReasons + own (luật self) + việc còn lại (thiếu hồ sơ / ngày vào, MISSING_OUT); DTO parse được', async () => {
    const { q, runs, h } = setup();
    await h.profile(MIA, '2026-01', 10_000_000);
    h.days.set(MIA, { ok: true, halfDays: 48, missingOutDates: ['2026-11-16'], sickDays: 1 });
    await runs.create(KAI, '2026-11');
    const dto = await q.run(KAI, '2026-11');
    expect(PayrollRunDto.parse(dto)).toEqual(dto);
    expect(dto.payslips.find((r) => r.user.id === KAI)).toMatchObject({
      own: true,
      blockReasons: ['MISSING_SALARY_PROFILE'],
    });
    expect(dto.todo).toEqual(
      expect.arrayContaining([
        { kind: 'MISSING_SALARY_PROFILE', user: { id: MAX, fullName: 'Max' }, date: null },
        { kind: 'MISSING_HIRE_DATE', user: { id: MAX, fullName: 'Max' }, date: null },
        { kind: 'MISSING_OUT', user: { id: MIA, fullName: 'Mia' }, date: '2026-11-16' },
      ]),
    );
    expect(dto.recalculable).toBe(true);
  });

  it('phiếu đầy đủ: ảnh chụp + hasSickDays; xem phiếu ⇒ audit PAYROLL_PAYSLIP_VIEW', async () => {
    const { q, runs, h } = setup();
    await h.profile(MIA, '2026-01', 10_000_000);
    h.days.set(MIA, { ok: true, halfDays: 50, missingOutDates: [], sickDays: 1 });
    await runs.create(KAI, '2026-11');
    const p = await q.payslip(KAI, '2026-11', MIA);
    expect(PayslipDto.parse(p)).toEqual(p);
    expect(p).toMatchObject({
      status: 'DRAFT',
      companyName: null,
      hasSickDays: true,
      seniorityPerYear: 500_000,
    });
    expect(h.audit.at(-1)?.action).toBe('PAYROLL_PAYSLIP_VIEW');
  });
});

describe('phiếu của tôi (nhân viên)', () => {
  it('nháp ⇒ không thấy (404); phát hành ⇒ thấy bản hiệu lực + bản cũ theo revision; danh sách không số tiền', async () => {
    const { q, runs, publish, edits, h } = setup();
    for (const u of [KAI, MIA, MAX]) await h.profile(u, '2026-01', 10_000_000);
    h.hireDates.set(MAX, '2025-01-01');
    await runs.create(KAI, '2026-11');
    await expect(q.myPayslip(MIA, '2026-11')).rejects.toMatchObject({ statusCode: 404 });
    expect(await q.mine(MIA)).toEqual([]);
    await publish.execute(KAI, '2026-11');
    await edits.revise(KAI, {
      period: '2026-11',
      userId: MIA,
      expectedRevision: 1,
      reason: 'Thêm thưởng',
      lines: [{ section: 'BONUS', label: 'Thưởng', amount: 1 }],
      note: null,
      overrideHalfDays: null,
      overrideReason: null,
    });
    const list = await q.mine(MIA);
    expect(list.map((r) => [r.period, r.revision, Object.keys(r).sort()])).toEqual([
      ['2026-11', 2, ['period', 'publishedAt', 'revision']],
    ]);
    const latest = await q.myPayslip(MIA, '2026-11');
    expect(MyPayslipDto.parse(latest)).toEqual(latest);
    expect(latest).toMatchObject({
      revision: 2,
      revisionReason: 'Thêm thưởng',
      companyName: 'Công ty Bịa',
    });
    expect('lockVersion' in latest).toBe(false);
    expect((await q.myPayslip(MIA, '2026-11', 1)).revision).toBe(1);
    await expect(q.myPayslip(MAX, '2026-10')).rejects.toMatchObject({ statusCode: 404 });
  });
});
