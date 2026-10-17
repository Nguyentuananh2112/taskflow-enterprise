import { describe, expect, it } from 'vitest';

import { createLeaveHarness, U } from '../testing/leave-harness';
import { OFFBOARD_NOTE, REHIRE_NOTE } from './use-cases/employment-hooks.use-cases';

// Luật cấp công ty của leave (company-level.md v2.1 ADR-136/137; D H1/H2; CO-04, CO-11, LB-REHIRE). NOW = 17/11/2026.

const annual = (startDate: string, endDate = startDate) => ({
  type: 'ANNUAL' as const,
  startDate,
  endDate,
  dayPart: 'FULL' as const,
});
const id = (n: number) => `00000000-0000-7000-8000-0000000f${n.toString().padStart(4, '0')}`;

describe('CO-11 AFTER_LAST_DAY — đã có lịch nghỉ việc', () => {
  it('submit / preview đơn có ngày sau lastDay ⇒ 422 kèm lastDay; kết thúc đúng lastDay ⇒ được', async () => {
    const h = await createLeaveHarness();
    h.company.scheduleOffboard(U.Mia, '2026-11-25');
    for (const call of [
      () => h.leave.submit(h.as(U.Mia), annual('2026-11-25', '2026-11-26')),
      () => h.queries.preview(h.as(U.Mia), annual('2026-11-26')),
    ]) {
      await expect(call()).rejects.toMatchObject({
        statusCode: 422,
        details: { rule: 'AFTER_LAST_DAY', lastDay: '2026-11-25' },
      });
    }
    await expect(
      h.leave.submit(h.as(U.Mia), annual('2026-11-24', '2026-11-25')),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('approve đơn PENDING đã gửi trước khi có lịch nghỉ, ngày sau lastDay ⇒ 422 AFTER_LAST_DAY; reject vẫn được', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), startDate: '2026-11-30', endDate: '2026-11-30' });
    h.company.scheduleOffboard(U.Mia, '2026-11-27');
    await expect(h.leave.approve(h.as(U.Hana), id(1), 1)).rejects.toMatchObject({
      details: { rule: 'AFTER_LAST_DAY' },
    });
    await expect(h.leave.reject(h.as(U.Hana), id(1), 1)).resolves.toMatchObject({
      status: 'REJECTED',
    });
  });

  it('đơn APPROVED vắt qua lastDay: số dư chỉ trừ phần ≤ lastDay (đếm cắt theo nhiệm kỳ)', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), status: 'APPROVED', startDate: '2026-11-23', endDate: '2026-11-27' }); // T2–T6 = 5 ngày
    h.company.scheduleOffboard(U.Mia, '2026-11-24');
    await expect(h.queries.myBalance(h.as(U.Mia), 2026)).resolves.toMatchObject({
      usedDays: 2,
      remainingDays: 10,
    });
  });
});

describe('Admin không phải nhân viên (ADR-134)', () => {
  it('Admin gửi / xem đơn của mình / số dư của mình ⇒ 403 leave:self; Admin vẫn duyệt đơn của nhân viên', async () => {
    const h = await createLeaveHarness();
    await expect(h.leave.submit(h.as(U.Olivia), annual('2026-11-23'))).rejects.toMatchObject({
      statusCode: 403,
      details: { required: 'leave:self' },
    });
    await expect(h.queries.myBalance(h.as(U.Olivia), 2026)).rejects.toMatchObject({
      statusCode: 403,
    });
    await h.seed({ id: id(1) });
    await expect(h.leave.approve(h.as(U.Olivia), id(1), 1)).resolves.toMatchObject({
      status: 'APPROVED',
    });
  });
});

describe('LB-REHIRE — nhận lại cùng năm (D H2)', () => {
  it('đơn của nhiệm kỳ trước không trừ vào nhiệm kỳ mới; adjustment năm đó reset về 0 có audit', async () => {
    const h = await createLeaveHarness();
    // Nhiệm kỳ 1 của Pam: nghỉ 6 ngày tháng 3, HR trừ −4 nửa ngày; nghỉ việc 31/03.
    await h.seed({
      id: id(1),
      userId: U.Pam,
      status: 'APPROVED',
      startDate: '2026-03-02',
      endDate: '2026-03-07',
    });
    await h.leave.adjustBalance(h.as(U.Hana), { userId: U.Pam, year: 2026, adjustment: -4 });
    h.company.offboard(U.Pam, '2026-03-31');
    // Nhận lại 01/09: lõi của company gọi hook reset trong cùng transaction.
    h.company.rehire(U.Pam, '2026-09-01');
    await expect(
      h.hooks.resetOnRehire({ userId: U.Pam, year: 2026, actorId: U.Hana }),
    ).resolves.toBe(true);
    await expect(h.queries.myBalance(h.as(U.Pam), 2026)).resolves.toMatchObject({
      adjustmentDays: 0,
      usedDays: 0,
      remainingDays: 12,
    });
    expect(h.audit.entries.at(-1)).toMatchObject({
      action: 'BALANCE_ADJUST',
      targetUserId: U.Pam,
      before: { adjustmentHalfDays: -4 },
      after: { adjustmentHalfDays: 0 },
      note: REHIRE_NOTE,
    });
    // Lần 2 (đã 0) ⇒ không ghi gì.
    await expect(
      h.hooks.resetOnRehire({ userId: U.Pam, year: 2026, actorId: U.Hana }),
    ).resolves.toBe(false);
  });
});

describe('CO-04 offboardCleanup — hành động hệ thống (D H1)', () => {
  it('PENDING ⇒ CANCELLED, APPROVED sau lastDay ⇒ REVOKED (kể cả đã qua ngày bắt đầu), vắt qua giữ; một thông báo tổng; audit từng đơn', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), startDate: '2026-11-10', endDate: '2026-11-10' }); // PENDING (đã qua)
    await h.seed({ id: id(2), startDate: '2026-12-01', endDate: '2026-12-01' }); // PENDING
    await h.seed({ id: id(3), status: 'APPROVED', startDate: '2026-11-12', endDate: '2026-11-13' }); // vắt qua
    await h.seed({ id: id(4), status: 'APPROVED', startDate: '2026-11-16', endDate: '2026-11-16' }); // sau, đã qua
    await h.seed({ id: id(5), status: 'APPROVED', startDate: '2026-12-02', endDate: '2026-12-02' }); // sau
    await h.seed({ id: id(6), status: 'REJECTED', startDate: '2026-12-03', endDate: '2026-12-03' });
    await h.seed({ id: id(7), userId: U.Max, startDate: '2026-12-01', endDate: '2026-12-01' }); // người khác
    const result = await h.hooks.offboardCleanup({
      userId: U.Mia,
      lastDay: '2026-11-12',
      actorId: U.Hana,
    });
    expect(result).toEqual({ cancelled: 2, revoked: 2 });
    const rows = new Map((await h.rows()).map((r) => [r.id, r]));
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => rows.get(id(n))?.status)).toEqual([
      'CANCELLED',
      'CANCELLED',
      'APPROVED',
      'REVOKED',
      'REVOKED',
      'REJECTED',
      'PENDING',
    ]);
    expect(rows.get(id(4))).toMatchObject({
      decidedBy: U.Hana,
      decisionNote: OFFBOARD_NOTE,
      version: 2,
    });
    expect(h.locks).toEqual([`taskflow:leave:${U.Mia}`]);
    expect(h.notifier.sent).toEqual([
      { type: 'OFFBOARD_CLEANUP', requestId: U.Mia, actorId: U.Hana, recipient: { kind: 'hr' } },
    ]);
    // Theo thứ tự startDate của listOpen: 10/11 (PENDING), 16/11 (APPROVED), 01/12 (PENDING), 02/12 (APPROVED).
    expect(h.audit.entries.map((e) => [e.refId, e.action])).toEqual([
      [id(1), 'LEAVE_CANCEL'],
      [id(4), 'LEAVE_REVOKE'],
      [id(2), 'LEAVE_CANCEL'],
      [id(5), 'LEAVE_REVOKE'],
    ]);
    expect(JSON.stringify(h.audit.entries)).not.toContain('việc riêng');
  });

  it('không có đơn mở ⇒ không ghi, không thông báo', async () => {
    const h = await createLeaveHarness();
    await expect(
      h.hooks.offboardCleanup({ userId: U.Max, lastDay: '2026-11-30', actorId: U.Hana }),
    ).resolves.toEqual({ cancelled: 0, revoked: 0 });
    expect(h.notifier.sent).toEqual([]);
    expect(h.audit.entries).toEqual([]);
  });
});
