import { LEAVE_POLICY_DEFAULTS } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { SpyLogger } from '../../../../test/support';
import { LEGAL_LEAVE_POLICY } from '../domain/leave-policy';
import { createLeaveHarness, U } from '../testing/leave-harness';
import { LeaveCarryoverJob } from './use-cases/leave-carryover.job';
import { GetLeavePolicyQuery, PutLeavePolicyUseCase } from './use-cases/leave-policy.use-cases';

// T-057 (hr-extended ADR-131; test-spec-hr-extended LP-01…13 ở mức use case). Mốc harness 17/11/2026 (thứ Ba),
// lịch giả T2–T7 làm. Hana = HR, Mia = nhân viên (nhiệm kỳ từ 2020-01-06, liên tục).

type H = Awaited<ReturnType<typeof createLeaveHarness>>;
const body = (over: Partial<typeof LEAVE_POLICY_DEFAULTS> & { expectedVersion?: number } = {}) => ({
  ...LEAVE_POLICY_DEFAULTS,
  expectedVersion: 0,
  ...over,
});
const put = (h: H, year: number, b: ReturnType<typeof body>, actor = U.Hana) =>
  new PutLeavePolicyUseCase(h.kit, h.readModel, h.employees).execute(h.as(actor), year, b);
const get = (h: H, year: number, actor = U.Hana) =>
  new GetLeavePolicyQuery(h.kit).execute(h.as(actor), year);
const id = (n: number) => `00000000-0000-7000-8000-0000000e${n.toString().padStart(4, '0')}`;

describe('LP-01 GET / PUT chính sách', () => {
  it('chưa có dòng ⇒ DEFAULT mức luật, version 0; chỉ năm nay + năm sau sửa được; nhân viên ⇒ 403', async () => {
    const h = await createLeaveHarness();
    await expect(get(h, 2026)).resolves.toMatchObject({
      ...LEAVE_POLICY_DEFAULTS,
      year: 2026,
      source: 'DEFAULT',
      inheritedFromYear: null,
      version: 0,
      editable: true,
      updatedBy: null,
    });
    expect((await get(h, 2027)).editable).toBe(true);
    expect((await get(h, 2025)).editable).toBe(false);
    expect((await get(h, 2028)).editable).toBe(false);
    await expect(get(h, 2026, U.Mia)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('PUT tạo (version 0 ⇒ 1); năm sau kế thừa; khóa policy EXCLUSIVE trước tiên; audit POLICY_SET có note', async () => {
    const h = await createLeaveHarness();
    const res = await put(h, 2026, body({ annualDays: 14, reason: '  Tăng phép  ' }));
    expect(res.policy).toMatchObject({ annualDays: 14, source: 'SET', version: 1 });
    expect(res.policy.updatedBy).toMatchObject({ id: U.Hana });
    expect(h.locks[0]).toBe('taskflow:leave-policy:exclusive');
    await expect(get(h, 2027)).resolves.toMatchObject({
      annualDays: 14,
      source: 'INHERITED',
      inheritedFromYear: 2026,
      version: 0,
    });
    expect(h.audit.entries.at(-1)).toMatchObject({
      action: 'POLICY_SET',
      targetUserId: null,
      before: { year: 2026, annualDays: 12 },
      after: { year: 2026, annualDays: 14 },
      note: 'Tăng phép',
    });
  });

  it('SEC-HR-55: năm đã qua / năm sau + 1 ⇒ 422 POLICY_YEAR_LOCKED; lệch version ⇒ 409 kèm bản hiện tại', async () => {
    const h = await createLeaveHarness();
    for (const year of [2025, 2028]) {
      await expect(put(h, year, body())).rejects.toMatchObject({
        statusCode: 422,
        details: { rule: 'POLICY_YEAR_LOCKED' },
      });
    }
    await put(h, 2026, body({ annualDays: 13 }));
    await expect(put(h, 2026, body({ annualDays: 15 }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 1, current: { annualDays: 13 } },
    });
    await expect(put(h, 2026, body(), U.Mia)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('LP-02/04 số phép theo chính sách + thâm niên', () => {
  it('chính sách năm áp vào số dư; ngày vào 2016 ⇒ 10 năm ⇒ +2; thiếu ngày vào ⇒ cờ, không thâm niên', async () => {
    const h = await createLeaveHarness();
    await expect(h.queries.myBalance(h.as(U.Mia), 2026)).resolves.toMatchObject({
      entitledDays: 12,
      missingHireDate: true,
      seniorityYears: null,
      entitledSource: 'POLICY',
    });
    await put(h, 2026, body({ annualDays: 14 }));
    h.hireDates.set(U.Mia, '2016-06-01');
    await expect(h.queries.myBalance(h.as(U.Mia), 2026)).resolves.toMatchObject({
      entitledDays: 16,
      baseDays: 16,
      seniorityBonusDays: 2,
      seniorityYears: 10,
      missingHireDate: false,
      remainingDays: 16,
    });
  });
});

describe('LP-10 hạ chính sách năm nay ⇒ negativeBalances; đơn đã duyệt không bị đụng', () => {
  it('đặt 20 ngày, Mia dùng 16, hạ về 12 ⇒ Mia còn −4', async () => {
    const h = await createLeaveHarness();
    await put(h, 2026, body({ annualDays: 20 }));
    // 02/11 (T2) … 19/11 (T5), T2–T7 làm ⇒ 6 + 6 + 4 = 16 ngày.
    await h.seed({ id: id(1), status: 'APPROVED', startDate: '2026-11-02', endDate: '2026-11-19' });
    const res = await put(h, 2026, body({ annualDays: 12, expectedVersion: 1 }));
    expect(res.negativeBalances).toEqual([
      { userId: U.Mia, user: expect.objectContaining({ id: U.Mia }) as unknown, remainingDays: -4 },
    ]);
    expect((await h.rows()).find((r) => r.id === id(1))?.status).toBe('APPROVED');
    // Năm sau chưa bắt đầu ⇒ không cảnh báo.
    expect((await put(h, 2027, body())).negativeBalances).toEqual([]);
  });
});

describe('LP-06/09/09b/12 phép chuyển sang', () => {
  const carryPolicy = async (h: H) => {
    // Năm đã qua không PUT được qua API ⇒ dựng thẳng trong store: 2025 bật chuyển, trần 5 ngày, hết hạn cuối tháng 12.
    await h.policies.put({
      year: 2025,
      policy: {
        ...LEGAL_LEAVE_POLICY,
        carryOverEnabled: true,
        carryOverMax: 10,
        carryOverExpiryMonth: 12,
      },
      expectedVersion: 0,
      updatedById: U.Hana,
      at: new Date('2025-01-02T00:00:00Z'),
    });
    // 2025 Mia dùng 2 ngày (03–04/03) ⇒ còn 10 ⇒ chuyển min(5, 10) = 5.
    await h.seed({ id: id(9), status: 'APPROVED', startDate: '2025-03-03', endDate: '2025-03-04' });
  };

  it('LP-12: GET khi chưa chụp ⇒ tạm tính, carriedFinal false, KHÔNG tạo dòng; ghi đầu tiên chụp đúng số đó', async () => {
    const h = await createLeaveHarness();
    await carryPolicy(h);
    await expect(h.queries.myBalance(h.as(U.Mia), 2026)).resolves.toMatchObject({
      carriedOverDays: 5,
      carriedFinal: false,
      carriedExpiresOn: '2026-12-31',
      carriedUsableDays: 5,
      remainingDays: 17,
    });
    expect(await h.readModel.findBalance(U.Mia, 2026)).toBeNull();
    await h.leave.submit(h.as(U.Mia), {
      type: 'ANNUAL',
      startDate: '2026-11-30',
      endDate: '2026-11-30',
      dayPart: 'FULL',
    });
    expect(await h.readModel.findBalance(U.Mia, 2026)).toMatchObject({ carried: 10 });
    await expect(h.queries.myBalance(h.as(U.Mia), 2026)).resolves.toMatchObject({
      carriedOverDays: 5,
      carriedFinal: true,
      pendingDays: 1,
      carriedUsableDays: 4, // ngày chờ duyệt ≤ hạn lấy từ phép chuyển sang trước
      remainingDays: 16,
    });
  });

  it('LP-09: PATCH điều chỉnh 2025 SAU khi đã chụp ⇒ carried 2026 tính lại (−8 ⇒ còn 2 ⇒ chuyển 2)', async () => {
    const h = await createLeaveHarness();
    await carryPolicy(h);
    await h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2026, adjustment: 0 }); // chụp 2026
    expect(await h.readModel.findBalance(U.Mia, 2026)).toMatchObject({ carried: 10 });
    await h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2025, adjustment: -16 });
    expect(await h.readModel.findBalance(U.Mia, 2026)).toMatchObject({ carried: 4 });
  });

  it('LP-09b: duyệt muộn đơn 2025 (khi 2026 đã chụp) ⇒ carried 2026 giảm', async () => {
    const h = await createLeaveHarness();
    await carryPolicy(h);
    // Thêm 6 ngày đã duyệt (02–07/06/2025, T2–T7) ⇒ 2025 dùng 8, còn 4 < trần 5 ⇒ chuyển 4.
    await h.seed({ id: id(7), status: 'APPROVED', startDate: '2025-06-02', endDate: '2025-06-07' });
    await h.seed({ id: id(8), startDate: '2025-12-29', endDate: '2025-12-31' }); // PENDING 3 ngày (T2–T4)
    await h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2026, adjustment: 0 }); // chụp 2026
    expect(await h.readModel.findBalance(U.Mia, 2026)).toMatchObject({ carried: 8 }); // PENDING không trừ
    await h.leave.approve(h.as(U.Hana), id(8), 1);
    // Duyệt muộn trong 2026 ⇒ 2025 còn 12 − 8 − 3 = 1 ⇒ carried 2026 tính lại = 1 ngày.
    expect(await h.readModel.findBalance(U.Mia, 2026)).toMatchObject({ carried: 2 });
  });

  it('job leave-carryover: chụp mọi nhân viên còn NULL; chạy lại ⇒ 0 (idempotent)', async () => {
    const h = await createLeaveHarness();
    await carryPolicy(h);
    const job = new LeaveCarryoverJob(h.kit, h.employees, new SpyLogger());
    const first = await job.runOnce();
    expect(first.year).toBe(2026);
    expect(first.snapshotted).toBeGreaterThan(0);
    expect(await h.readModel.findBalance(U.Mia, 2026)).toMatchObject({ carried: 10 });
    await expect(job.runOnce()).resolves.toEqual({ year: 2026, snapshotted: 0 });
  });
});

describe('T-054 ↔ T-057: phép âm nếu đổi ngày vào công ty (ADR-128/131)', () => {
  it('vào 2010 ⇒ 15 ngày, đã dùng 15; đổi sang 2024 ⇒ còn −3 năm nay; giữ nguyên ⇒ không có năm âm', async () => {
    const h = await createLeaveHarness();
    h.hireDates.set(U.Mia, '2010-01-01');
    // 02/11 … 18/11 ⇒ 6 + 6 + 3 = 15 ngày.
    await h.seed({ id: id(5), status: 'APPROVED', startDate: '2026-11-02', endDate: '2026-11-18' });
    await expect(
      h.hooks.negativeBalancesIfHireDate({ userId: U.Mia, hireDate: '2024-01-01' }),
    ).resolves.toEqual([{ year: 2026, remainingDays: -3 }]);
    await expect(
      h.hooks.negativeBalancesIfHireDate({ userId: U.Mia, hireDate: '2010-01-01' }),
    ).resolves.toEqual([]);
    expect(await h.readModel.findBalance(U.Mia, 2026)).toBeNull(); // chỉ đọc
  });
});
