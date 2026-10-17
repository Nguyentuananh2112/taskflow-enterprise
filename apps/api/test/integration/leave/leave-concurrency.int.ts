// Tầng C (test-spec-hr §8, phần leave): N lệnh song song trên Postgres thật, kết nối riêng của pool; mỗi ca ×20
// (`LEAVE_CC_REPEAT`). Kiểm khóa advisory (ws, user) + UPDATE có điều kiện version cho ra kết quả như chạy tuần tự.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createLeaveHarness, U } from '../../../src/modules/leave/testing/leave-harness';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';
import { prismaLeaveBackend } from './prisma-leave-backend';

const REPEAT = Number(process.env.LEAVE_CC_REPEAT ?? '20');
const rounds = Array.from({ length: REPEAT }, (_, i) => i + 1);
const R1 = '00000000-0000-7000-8000-0000000c0001';
const R2 = '00000000-0000-7000-8000-0000000c0002';

const harness = () => createLeaveHarness(prismaLeaveBackend());
const settle = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({
      ok: false as const,
      error: error as { statusCode?: number; details?: Record<string, unknown> },
    }),
  );
const day = (startDate: string, endDate = startDate, dayPart: 'FULL' | 'AM' | 'PM' = 'FULL') => ({
  type: 'ANNUAL' as const,
  startDate,
  endDate,
  dayPart,
  reason: 'race',
});

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

describe.each(rounds)('leave — đồng thời (lượt %i)', () => {
  it('CC-HR-03: approve ‖ cancel cùng đơn ⇒ đúng 1 thắng, bên thua 409, trạng thái cuối = bên thắng', async () => {
    const h = await harness();
    await h.seed({ id: R1, startDate: '2026-11-23', endDate: '2026-11-23' });
    const [a, c] = await Promise.all([
      settle(h.leave.approve(h.as(U.Hana), R1, 1)),
      settle(h.leave.cancel(h.as(U.Mia), R1, 1)),
    ]);
    expect([a.ok, c.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? c : a;
    expect(loser.ok ? null : loser.error.statusCode).toBe(409);
    const [row] = await h.rows();
    expect(row).toMatchObject({ status: a.ok ? 'APPROVED' : 'CANCELLED', version: 2 });
    // Số dư khớp bên thắng: duyệt ⇒ dùng 1 ngày; hủy ⇒ trả hết.
    expect(await h.queries.myBalance(h.as(U.Mia), 2026)).toMatchObject(
      a.ok
        ? { usedDays: 1, pendingDays: 0, remainingDays: 11 }
        : { usedDays: 0, pendingDays: 0, remainingDays: 12 },
    );
  });

  it('CC-HR-04: 2 đơn ANNUAL song song, tổng vượt số dư ⇒ 1 × thành công, 1 × 422 INSUFFICIENT_BALANCE', async () => {
    const h = await harness();
    await h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2026, adjustment: -20 }); // còn 4 nửa ngày = 2 ngày
    const results = await Promise.all([
      settle(h.leave.submit(h.as(U.Mia), day('2026-11-23', '2026-11-24'))),
      settle(h.leave.submit(h.as(U.Mia), day('2026-11-30', '2026-12-01'))),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed?.ok === false && failed.error.details).toMatchObject({
      rule: 'INSUFFICIENT_BALANCE',
    });
    expect(await h.rows()).toHaveLength(1);
  });

  it('CC-HR-05: 2 đơn chồng ngày song song ⇒ 1 × thành công, 1 × 409 overlapping_leave', async () => {
    const h = await harness();
    const results = await Promise.all([
      settle(h.leave.submit(h.as(U.Mia), day('2026-11-23', '2026-11-24'))),
      settle(h.leave.submit(h.as(U.Mia), day('2026-11-24', '2026-11-25'))),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed?.ok === false && failed.error.details).toMatchObject({
      reason: 'overlapping_leave',
    });
  });

  it('CC-HR-06: AM ‖ PM cùng ngày ⇒ cả hai thành công (D-M2)', async () => {
    const h = await harness();
    const results = await Promise.all([
      settle(h.leave.submit(h.as(U.Mia), day('2026-11-23', '2026-11-23', 'AM'))),
      settle(h.leave.submit(h.as(U.Mia), day('2026-11-23', '2026-11-23', 'PM'))),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await h.rows()).toHaveLength(2);
  });

  it('CC-HR-07: submit ‖ HR giảm số dư ⇒ tuần tự dưới cùng khóa, chứng minh bằng thứ tự audit; số dư cuối khớp thứ tự', async () => {
    const h = await harness();
    // Còn 24 nửa ngày; giảm 22 ⇒ còn 2. Đơn 2 ngày = 4 nửa ngày.
    const [s, p] = await Promise.all([
      settle(h.leave.submit(h.as(U.Mia), day('2026-11-23', '2026-11-24'))),
      settle(h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2026, adjustment: -22 })),
    ]);
    expect(p.ok).toBe(true); // PATCH luôn 200, kể cả khi remaining − pending < 0 (TL chốt (a))
    const order = h.audit.entries.map((e) => e.action);
    const balance = await h.queries.myBalance(h.as(U.Mia), 2026);
    if (order[0] === 'BALANCE_ADJUST') {
      expect(order).toEqual(['BALANCE_ADJUST']);
      expect(s.ok ? null : s.error.details).toMatchObject({ rule: 'INSUFFICIENT_BALANCE' });
      expect(await h.rows()).toHaveLength(0);
      expect(balance).toMatchObject({ adjustmentDays: -11, pendingDays: 0, remainingDays: 1 });
    } else {
      expect(order).toEqual(['LEAVE_SUBMIT', 'BALANCE_ADJUST']);
      expect(s.ok).toBe(true);
      expect(await h.rows()).toHaveLength(1);
      expect(balance).toMatchObject({ adjustmentDays: -11, pendingDays: 2, remainingDays: -1 });
    }
    expect(h.locks.filter((l) => l.endsWith(U.Mia))).toHaveLength(2); // cả hai lệnh lấy CÙNG khóa
  });

  it('CC-HR-08: approve ‖ HR giảm số dư ⇒ [LEAVE_DECIDE, BALANCE_ADJUST] ⇒ APPROVED; [BALANCE_ADJUST] trước ⇒ approve BẮT BUỘC 422', async () => {
    const h = await harness();
    await h.seed({ id: R1, startDate: '2026-11-23', endDate: '2026-11-24' }); // 4 nửa ngày đang chờ
    const [a, p] = await Promise.all([
      settle(h.leave.approve(h.as(U.Hana), R1, 1)),
      settle(
        h.leave.adjustBalance(h.as(U.Olivia), {
          userId: U.Mia,
          year: 2026,
          adjustment: -22,
          note: 'x',
        }),
      ),
    ]);
    expect(p.ok).toBe(true);
    const order = h.audit.entries.map((e) => e.action);
    const [row] = await h.rows();
    const balance = await h.queries.myBalance(h.as(U.Mia), 2026);
    if (order[0] === 'BALANCE_ADJUST') {
      expect(order).toEqual(['BALANCE_ADJUST']);
      expect(a.ok ? null : a.error.details).toMatchObject({ rule: 'INSUFFICIENT_BALANCE' });
      expect(row?.status).toBe('PENDING');
      expect(balance).toMatchObject({ usedDays: 0, pendingDays: 2, remainingDays: -1 });
    } else {
      expect(order).toEqual(['LEAVE_DECIDE', 'BALANCE_ADJUST']);
      expect(a.ok).toBe(true);
      expect(row?.status).toBe('APPROVED');
      expect(balance).toMatchObject({ usedDays: 2, pendingDays: 0, remainingDays: -1 }); // âm — Q4
    }
  });

  it('CC-HR-09: 2 HR approve ‖ reject cùng đơn ⇒ 1 thắng, 1 409', async () => {
    const h = await harness();
    await h.seed({ id: R1, startDate: '2026-11-23', endDate: '2026-11-23' });
    const results = await Promise.all([
      settle(h.leave.approve(h.as(U.Hana), R1, 1)),
      settle(h.leave.reject(h.as(U.Olivia), R1, 1, 'không')),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.ok === false && results.find((r) => !r.ok)).toMatchObject({
      error: { statusCode: 409 },
    });
  });

  it('CC-HR-10: revoke ‖ người gửi cancel (APPROVED, chưa bắt đầu) ⇒ 1 thắng; số dư trả đúng 1 lần', async () => {
    const h = await harness();
    await h.seed({ id: R1, status: 'APPROVED', startDate: '2026-11-23', endDate: '2026-11-24' });
    await h.seed({ id: R2, status: 'APPROVED', startDate: '2026-11-02', endDate: '2026-11-12' }); // 10 ngày đã dùng
    const results = await Promise.all([
      settle(h.leave.revoke(h.as(U.Hana), R1, 1, 'thiếu người')),
      settle(h.leave.cancel(h.as(U.Mia), R1, 1)),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const rows = await h.rows();
    expect(rows.find((r) => r.id === R1)?.status).toMatch(/^(REVOKED|CANCELLED)$/);
    // Số dư: 24 − 20 (R2) = 4 ⇒ đơn 2 ngày mới vừa đủ (R1 đã trả, không trả 2 lần ⇒ đơn 3 ngày vẫn thiếu).
    await expect(
      h.leave.submit(h.as(U.Mia), day('2026-11-30', '2026-12-02')),
    ).rejects.toMatchObject({
      details: { rule: 'INSUFFICIENT_BALANCE' },
    });
    await expect(
      h.leave.submit(h.as(U.Mia), day('2026-11-30', '2026-12-01')),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('CC-HR-11 (mức fake, bản thật khi có adapter T-037): thu grant ‖ approve ⇒ approve chỉ thành công nếu đọc lại quyền TRƯỚC khi thu', async () => {
    const h = await harness();
    await h.seed({ id: R1, startDate: '2026-11-23', endDate: '2026-11-23' });
    const events: string[] = [];
    const reload = h.company.reloadActor.bind(h.company);
    h.company.reloadActor = async (user) => {
      const actor = await reload(user);
      if (user === U.Hana)
        events.push(actor?.permissions.has('hr:manage') ? 'reload:hr' : 'reload:-');
      return actor;
    };
    const revoke = async () => {
      await new Promise((r) => setImmediate(r));
      h.company.revokeGrant(U.Hana, 'HR_MANAGE');
      events.push('revoke');
    };
    const [a] = await Promise.all([settle(h.leave.approve(h.as(U.Hana), R1, 1)), revoke()]);
    const [row] = await h.rows();
    if (a.ok) {
      // Mọi lần đọc quyền (trước khóa + SAU khóa — B-H3) đều trước khi thu.
      expect(events).not.toContain('reload:-');
      expect(events.lastIndexOf('reload:hr')).toBeLessThan(events.indexOf('revoke'));
      expect(row?.status).toBe('APPROVED');
    } else {
      expect(a.error.statusCode).toBe(403);
      expect(events.indexOf('revoke')).toBeLessThan(events.lastIndexOf('reload:-'));
      expect(row?.status).toBe('PENDING');
    }
  });

  it('CC-HR-12: tạo lười LeaveBalance song song (2 transaction lần đầu) ⇒ đúng 1 dòng, không lỗi trùng khóa', async () => {
    const h = await harness();
    const results = await Promise.all([
      settle(h.uow.run(() => h.requests.getOrCreateBalance(U.Mia, 2026))),
      settle(h.uow.run(() => h.requests.getOrCreateBalance(U.Mia, 2026))),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await testPrisma().leaveBalance.count({ where: { userId: U.Mia } })).toBe(1);
  });
});
