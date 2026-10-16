import { describe, expect, it } from 'vitest';

import { createLeaveHarness, U, W1, W2 } from '../testing/leave-harness';

const mia2days = {
  type: 'ANNUAL' as const,
  startDate: '2026-11-23',
  endDate: '2026-11-24',
  dayPart: 'FULL' as const,
  reason: 'về quê',
};

describe('LeaveCommands.submit (test-spec §2, §3)', () => {
  it('LV-01: Mia gửi ANNUAL 2 ngày ⇒ PENDING, days 2, khóa (ws, Mia) TRƯỚC, thông báo HR, audit không chứa reason', async () => {
    const h = await createLeaveHarness();
    const dto = await h.leave.submit(h.as(U.Mia), mia2days);
    expect(dto).toMatchObject({
      status: 'PENDING',
      days: 2,
      version: 1,
      userId: U.Mia,
      reason: 'về quê',
    });
    expect(h.locks).toEqual([`taskflow:leave:${W1}:${U.Mia}`]);
    expect(h.notifier.sent).toEqual([
      {
        workspaceId: W1,
        type: 'LEAVE_SUBMITTED',
        requestId: dto.id,
        actorId: U.Mia,
        recipient: { kind: 'hr' },
      },
    ]);
    expect(h.audit.entries).toHaveLength(1);
    expect(h.audit.entries[0]).toMatchObject({
      action: 'LEAVE_SUBMIT',
      targetUserId: U.Mia,
      refId: dto.id,
    });
    expect(JSON.stringify(h.audit.entries)).not.toContain('về quê');
    expect(JSON.stringify(h.notifier.sent)).not.toContain('về quê');
  });

  it('LD-06: chỉ Chủ nhật ⇒ 422 NO_WORKING_DAYS, không ghi gì', async () => {
    const h = await createLeaveHarness();
    await expect(
      h.leave.submit(h.as(U.Mia), { ...mia2days, startDate: '2026-11-22', endDate: '2026-11-22' }),
    ).rejects.toMatchObject({ statusCode: 422, details: { rule: 'NO_WORKING_DAYS' } });
    expect(await h.rows()).toEqual([]);
    expect(h.uow.rollbacks).toBe(1);
  });

  it('LD-06b: nửa ngày rơi vào ngày lễ ⇒ 422 NO_WORKING_DAYS', async () => {
    const h = await createLeaveHarness();
    h.calendar.holidays.add('2026-11-23');
    await expect(
      h.leave.submit(h.as(U.Mia), { ...mia2days, endDate: '2026-11-23', dayPart: 'AM' }),
    ).rejects.toMatchObject({ details: { rule: 'NO_WORKING_DAYS' } });
  });

  it('LD-07/08: hình dạng sai bị chặn TRƯỚC khi khóa (400 dayPart; 422 LEAVE_SPANS_YEARS)', async () => {
    const h = await createLeaveHarness();
    await expect(h.leave.submit(h.as(U.Mia), { ...mia2days, dayPart: 'AM' })).rejects.toMatchObject(
      { statusCode: 400 },
    );
    await expect(
      h.leave.submit(h.as(U.Mia), { ...mia2days, startDate: '2026-12-30', endDate: '2027-01-02' }),
    ).rejects.toMatchObject({ statusCode: 422, details: { rule: 'LEAVE_SPANS_YEARS' } });
    expect(h.locks).toEqual([]);
  });

  it('LV-02: chồng ngày với đơn PENDING/APPROVED của chính Mia ⇒ 409 overlapping_leave', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'p', startDate: '2026-11-24', endDate: '2026-11-25' });
    await expect(h.leave.submit(h.as(U.Mia), mia2days)).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'overlapping_leave', requestId: 'p' },
    });
    const g = await createLeaveHarness();
    await g.seed({ id: 'a', status: 'APPROVED', startDate: '2026-11-23', endDate: '2026-11-23' });
    await expect(g.leave.submit(g.as(U.Mia), mia2days)).rejects.toMatchObject({
      details: { reason: 'overlapping_leave' },
    });
  });

  it('LV-03/04: AM khi đã có PM cùng ngày ⇒ được; AM khi đã có FULL ⇒ 409', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'pm', startDate: '2026-11-23', endDate: '2026-11-23', dayPart: 'PM' });
    const am = await h.leave.submit(h.as(U.Mia), {
      ...mia2days,
      endDate: '2026-11-23',
      dayPart: 'AM',
    });
    expect(am).toMatchObject({ status: 'PENDING', days: 0.5 });
    const g = await createLeaveHarness();
    await g.seed({ id: 'full', startDate: '2026-11-23', endDate: '2026-11-23' });
    await expect(
      g.leave.submit(g.as(U.Mia), { ...mia2days, endDate: '2026-11-23', dayPart: 'AM' }),
    ).rejects.toMatchObject({ details: { reason: 'overlapping_leave' } });
  });

  it('LV-05: đơn chết (REJECTED/CANCELLED/REVOKED) không chặn; đơn của NGƯỜI KHÁC cũng không', async () => {
    const h = await createLeaveHarness();
    for (const [id, status] of [
      ['r', 'REJECTED'],
      ['c', 'CANCELLED'],
      ['v', 'REVOKED'],
    ] as const) {
      await h.seed({ id, status, startDate: '2026-11-23', endDate: '2026-11-24' });
    }
    await h.seed({ id: 'max', userId: U.Max, startDate: '2026-11-23', endDate: '2026-11-24' });
    await expect(h.leave.submit(h.as(U.Mia), mia2days)).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('LV-06: ANNUAL vượt còn − đang chờ ⇒ 422 INSUFFICIENT_BALANCE; SICK thì không giới hạn', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'big', startDate: '2026-11-02', endDate: '2026-11-13' }); // 11 ngày làm (T2–T7, trừ CN 8/11) đang chờ
    await expect(h.leave.submit(h.as(U.Mia), mia2days)).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'INSUFFICIENT_BALANCE', remainingDays: 1, requestedDays: 2 },
    });
    await expect(h.leave.submit(h.as(U.Mia), { ...mia2days, type: 'SICK' })).resolves.toMatchObject(
      { days: 2 },
    );
  });

  it('LV-07: VIEWER ⇒ 403 leave:self (kiểm SAU khóa, trong transaction)', async () => {
    const h = await createLeaveHarness();
    await expect(h.leave.submit(h.as(U.Vic), mia2days)).rejects.toMatchObject({
      statusCode: 403,
      details: { required: 'leave:self' },
    });
  });

  it('không còn là thành viên ⇒ 404 workspace (ADR-020)', async () => {
    const h = await createLeaveHarness();
    await expect(h.leave.submit(h.as(U.Otto, W1), mia2days)).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'workspace' },
    });
  });
});

describe('LeaveCommands — HR duyệt / từ chối (test-spec §3)', () => {
  it('LV-08: Hana duyệt đơn của Mia ⇒ APPROVED, version+1, decidedBy, khóa (ws, Mia), thông báo Mia, audit LEAVE_DECIDE', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'r1' });
    const dto = await h.leave.approve(h.as(U.Hana), 'r1', 1);
    expect(dto).toMatchObject({
      status: 'APPROVED',
      version: 2,
      user: { id: U.Mia, fullName: 'Mia' },
      decidedBy: { id: U.Hana, fullName: 'Hana' },
      decidedAt: '2026-11-17T03:00:00.000Z',
      days: 1,
    });
    expect(h.locks).toEqual([`taskflow:leave:${W1}:${U.Mia}`]);
    expect(h.notifier.sent).toEqual([
      {
        workspaceId: W1,
        type: 'LEAVE_APPROVED',
        requestId: 'r1',
        actorId: U.Hana,
        recipient: { kind: 'user', userId: U.Mia },
      },
    ]);
    expect(h.audit.entries[0]).toMatchObject({
      action: 'LEAVE_DECIDE',
      before: { status: 'PENDING' },
      after: { status: 'APPROVED' },
    });
    expect(JSON.stringify(h.audit.entries)).not.toContain('việc riêng');
  });

  it('LV-09: Hana duyệt đơn của chính Hana ⇒ 403 (B-H1), không ghi gì', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'own', userId: U.Hana });
    await expect(h.leave.approve(h.as(U.Hana), 'own', 1)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await h.rows())[0]).toMatchObject({ status: 'PENDING', version: 1 });
  });

  it('LV-10: Olivia (OWNER) tự duyệt ⇒ thiếu lý do 422 REASON_REQUIRED (quy ước B), có lý do ⇒ 200 + audit note (R26)', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'boss', userId: U.Olivia });
    for (const note of [null, '   ']) {
      await expect(h.leave.approve(h.as(U.Olivia), 'boss', 1, note)).rejects.toMatchObject({
        statusCode: 422,
        details: { rule: 'REASON_REQUIRED' },
      });
    }
    await expect(
      h.leave.approve(h.as(U.Olivia), 'boss', 1, 'chủ công ty tự duyệt'),
    ).resolves.toMatchObject({
      status: 'APPROVED',
    });
    expect(h.audit.entries.at(-1)).toMatchObject({
      action: 'LEAVE_DECIDE',
      note: 'chủ công ty tự duyệt',
    });
  });

  it('LV-11: expectedVersion cũ ⇒ 409 version_conflict', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'r1', version: 3 });
    await expect(h.leave.approve(h.as(U.Hana), 'r1', 2)).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 3 },
    });
  });

  it('LV-12: số dư giảm sau khi gửi (đơn khác đã duyệt) ⇒ duyệt bị 422 INSUFFICIENT_BALANCE — kiểm LẠI trong khóa', async () => {
    const h = await createLeaveHarness();
    await h.seed({
      id: 'used',
      status: 'APPROVED',
      startDate: '2026-11-02',
      endDate: '2026-11-13',
    }); // 11 ngày
    await h.seed({ id: 'r1', startDate: '2026-11-23', endDate: '2026-11-24' }); // 2 ngày, chỉ còn 1
    await expect(h.leave.approve(h.as(U.Hana), 'r1', 1)).rejects.toMatchObject({
      details: { rule: 'INSUFFICIENT_BALANCE' },
    });
  });

  it('LB-02 qua use case: đơn VỪA ĐỦ số dư (đang nằm trong pending) vẫn duyệt được — loại chính nó', async () => {
    const h = await createLeaveHarness();
    await h.seed({
      id: 'used',
      status: 'APPROVED',
      startDate: '2026-11-02',
      endDate: '2026-11-12',
    }); // 10 ngày
    await h.seed({ id: 'r1', startDate: '2026-11-23', endDate: '2026-11-24' }); // đúng 2 ngày còn lại
    await expect(h.leave.approve(h.as(U.Hana), 'r1', 1)).resolves.toMatchObject({
      status: 'APPROVED',
    });
  });

  it('LV-13: Mia đã rời ws ⇒ duyệt 409 requester_not_member; TỪ CHỐI vẫn được (D-M4)', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'r1' });
    h.membership.remove(W1, U.Mia);
    await expect(h.leave.approve(h.as(U.Hana), 'r1', 1)).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'requester_not_member' },
    });
    await expect(h.leave.reject(h.as(U.Hana), 'r1', 1, 'đã nghỉ việc')).resolves.toMatchObject({
      status: 'REJECTED',
    });
  });

  it('LV-14: từ chối có ghi chú ⇒ REJECTED, thông báo LEAVE_REJECTED, số dư trả lại', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'r1', startDate: '2026-11-02', endDate: '2026-11-13' }); // 11 ngày đang chờ
    await h.leave.reject(h.as(U.Hana), 'r1', 1, 'trùng đợt cao điểm');
    expect(h.notifier.sent.at(-1)).toMatchObject({
      type: 'LEAVE_REJECTED',
      recipient: { kind: 'user', userId: U.Mia },
    });
    await expect(h.leave.submit(h.as(U.Mia), mia2days)).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('LV-23: duyệt lại đơn đã APPROVED ⇒ 409 invalid_transition', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'r1', status: 'APPROVED' });
    await expect(h.leave.approve(h.as(U.Hana), 'r1', 1)).rejects.toMatchObject({
      details: { reason: 'invalid_transition' },
    });
  });

  it('LV-25: Hana mất grant giữa lúc mở và bấm ⇒ 403 (đọc lại quyền SAU khóa — B-H3)', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'r1' });
    const lock = h.requests.lockUser.bind(h.requests);
    h.requests.lockUser = async (ws, user) => {
      h.membership.revokeGrant(W1, U.Hana, 'HR_MANAGE'); // thu grant đúng lúc đang chờ khóa
      return lock(ws, user);
    };
    await expect(h.leave.approve(h.as(U.Hana), 'r1', 1)).rejects.toMatchObject({ statusCode: 403 });
    expect((await h.rows())[0]).toMatchObject({ status: 'PENDING' });
  });

  it('thứ tự §0.3: thành viên thường gọi duyệt id KHÔNG tồn tại ⇒ 403 (không lộ id); HR gọi ⇒ 404 leave_request', async () => {
    const h = await createLeaveHarness();
    await expect(h.leave.approve(h.as(U.Max), 'nope', 1)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(h.leave.approve(h.as(U.Hana), 'nope', 1)).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'leave_request' },
    });
  });

  it('IDOR: đơn của W2 nhìn từ W1 ⇒ 404 như không tồn tại', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'w2req', workspaceId: W2, userId: U.Otto });
    await expect(h.leave.approve(h.as(U.Hana), 'w2req', 1)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('LeaveCommands — hủy / thu hồi (test-spec §3)', () => {
  it('LV-15: Mia hủy đơn PENDING của mình ⇒ CANCELLED, thông báo HR', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'r1' });
    await expect(h.leave.cancel(h.as(U.Mia), 'r1', 1)).resolves.toMatchObject({
      status: 'CANCELLED',
      version: 2,
    });
    expect(h.notifier.sent).toEqual([
      expect.objectContaining({ type: 'LEAVE_CANCELLED', recipient: { kind: 'hr' } }),
    ]);
    expect(h.audit.entries[0]).toMatchObject({ action: 'LEAVE_CANCEL' });
  });

  it('LV-16: Max hủy đơn của Mia ⇒ 404 (không lộ id đơn tồn tại); không khóa gì', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'r1' });
    await expect(h.leave.cancel(h.as(U.Max), 'r1', 1)).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'leave_request' },
    });
    expect(h.locks).toEqual([]);
  });

  it('LV-17/18: hủy đơn APPROVED trước ngày bắt đầu ⇒ được; bắt đầu HÔM NAY (giờ VN) ⇒ 409 invalid_transition', async () => {
    const h = await createLeaveHarness();
    await h.seed({
      id: 'future',
      status: 'APPROVED',
      startDate: '2026-11-18',
      endDate: '2026-11-18',
    });
    await expect(h.leave.cancel(h.as(U.Mia), 'future', 1)).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    await h.seed({
      id: 'today',
      status: 'APPROVED',
      startDate: '2026-11-17',
      endDate: '2026-11-17',
    });
    await expect(h.leave.cancel(h.as(U.Mia), 'today', 1)).rejects.toMatchObject({
      details: { reason: 'invalid_transition' },
    });
  });

  it('D-M5: "hôm nay" theo múi giờ lịch — 16/11 17:30Z đã là 17/11 ở VN ⇒ đơn bắt đầu 17/11 không hủy được nữa', async () => {
    const h = await createLeaveHarness();
    h.clock.set('2026-11-16T17:30:00.000Z'); // UTC vẫn 16/11
    await h.seed({ id: 'r', status: 'APPROVED', startDate: '2026-11-17', endDate: '2026-11-17' });
    await expect(h.leave.cancel(h.as(U.Mia), 'r', 1)).rejects.toMatchObject({
      details: { reason: 'invalid_transition' },
    });
    h.calendar.timezone = 'UTC';
    await expect(h.leave.cancel(h.as(U.Mia), 'r', 1)).resolves.toMatchObject({
      status: 'CANCELLED',
    });
  });

  it('LV-19/20/21: thu hồi cần lý do (400); trước ngày bắt đầu ⇒ REVOKED + thông báo Mia; đã bắt đầu ⇒ 409', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'r1', status: 'APPROVED', startDate: '2026-11-20', endDate: '2026-11-20' });
    await expect(h.leave.revoke(h.as(U.Hana), 'r1', 1, '  ')).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(h.leave.revoke(h.as(U.Hana), 'r1', 1, 'thiếu người')).resolves.toMatchObject({
      status: 'REVOKED',
    });
    expect(h.notifier.sent.at(-1)).toMatchObject({
      type: 'LEAVE_REVOKED',
      recipient: { kind: 'user', userId: U.Mia },
    });
    expect(h.audit.entries.at(-1)).toMatchObject({ action: 'LEAVE_REVOKE', note: 'thiếu người' });
    await h.seed({ id: 'r2', status: 'APPROVED', startDate: '2026-11-16', endDate: '2026-11-18' });
    await expect(h.leave.revoke(h.as(U.Hana), 'r2', 1, 'x')).rejects.toMatchObject({
      details: { reason: 'invalid_transition' },
    });
  });

  it('LV-22: đơn chết ⇒ mọi hành động 409 invalid_transition', async () => {
    const h = await createLeaveHarness();
    for (const status of ['REJECTED', 'CANCELLED', 'REVOKED'] as const) {
      await h.seed({ id: status, status });
      await expect(h.leave.approve(h.as(U.Hana), status, 1)).rejects.toMatchObject({
        details: { reason: 'invalid_transition' },
      });
      await expect(h.leave.cancel(h.as(U.Mia), status, 1)).rejects.toMatchObject({
        details: { reason: 'invalid_transition' },
      });
    }
  });
});

describe('LeaveCommands.adjustBalance (test-spec §4)', () => {
  it('LB-04: Hana chỉnh số dư của Mia ⇒ audit BALANCE_ADJUST trước/sau, khóa (ws, Mia)', async () => {
    const h = await createLeaveHarness();
    await h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2026, adjustment: -3 });
    expect(await h.requests.getOrCreateBalance(W1, U.Mia, 2026)).toEqual({
      entitled: 24,
      adjustment: -3,
    });
    expect(h.locks).toEqual([`taskflow:leave:${W1}:${U.Mia}`]);
    expect(h.audit.entries[0]).toMatchObject({
      action: 'BALANCE_ADJUST',
      targetUserId: U.Mia,
      before: { year: 2026, adjustmentHalfDays: 0 },
      after: { year: 2026, adjustmentHalfDays: -3 },
    });
  });

  it('LB-05: Hana chỉnh của chính Hana ⇒ 403 dù CÓ lý do (self kiểm trước lý do); OWNER tự chỉnh thiếu lý do ⇒ 422 REASON_REQUIRED', async () => {
    const h = await createLeaveHarness();
    await expect(
      h.leave.adjustBalance(h.as(U.Hana), {
        userId: U.Hana,
        year: 2026,
        adjustment: 4,
        note: 'có lý do',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      h.leave.adjustBalance(h.as(U.Olivia), { userId: U.Olivia, year: 2026, adjustment: 4 }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'REASON_REQUIRED' },
    });
    await expect(
      h.leave.adjustBalance(h.as(U.Olivia), {
        userId: U.Olivia,
        year: 2026,
        adjustment: 4,
        note: 'thâm niên',
      }),
    ).resolves.toBeUndefined();
  });

  it('LB-06: userId chưa từng có dữ liệu trong ws ⇒ 404 user; người đã rời nhưng còn đơn ⇒ được', async () => {
    const h = await createLeaveHarness();
    await expect(
      h.leave.adjustBalance(h.as(U.Hana), { userId: 'u-stranger', year: 2026, adjustment: 1 }),
    ).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'user' },
    });
    await h.seed({ id: 'rex', userId: U.Rex, status: 'APPROVED' });
    await expect(
      h.leave.adjustBalance(h.as(U.Hana), { userId: U.Rex, year: 2026, adjustment: 1 }),
    ).resolves.toBeUndefined();
  });

  it('LB-07: năm ngoài ±1 ⇒ 400 year; trong ±1 ⇒ được', async () => {
    const h = await createLeaveHarness();
    await expect(
      h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2024, adjustment: 1 }),
    ).rejects.toMatchObject({
      statusCode: 400,
      details: { issues: [expect.objectContaining({ path: ['year'] })] },
    });
    await expect(
      h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2027, adjustment: 1 }),
    ).resolves.toBeUndefined();
  });

  it('LB-08: adjustment âm làm số dư âm khi đã có đơn APPROVED ⇒ được; đơn ANNUAL mới ⇒ 422', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'a', status: 'APPROVED', startDate: '2026-11-02', endDate: '2026-11-07' }); // 6 ngày
    await expect(
      h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2026, adjustment: -20 }),
    ).resolves.toBeUndefined();
    await expect(
      h.leave.submit(h.as(U.Mia), { ...mia2days, startDate: '2026-11-30', endDate: '2026-11-30' }),
    ).rejects.toMatchObject({ details: { rule: 'INSUFFICIENT_BALANCE' } });
  });

  it('LD-09 qua use case: thêm lễ trùng đơn đã duyệt ⇒ số dư được trả lại khi đọc (không lưu days)', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: 'a', status: 'APPROVED', startDate: '2026-11-02', endDate: '2026-11-13' }); // 11 ngày ⇒ còn 1
    await expect(h.leave.submit(h.as(U.Mia), mia2days)).rejects.toMatchObject({
      details: { rule: 'INSUFFICIENT_BALANCE' },
    });
    h.calendar.holidays.add('2026-11-10');
    await expect(h.leave.submit(h.as(U.Mia), mia2days)).resolves.toMatchObject({
      status: 'PENDING',
    });
  });
});
