import { describe, expect, it } from 'vitest';

import { createLeaveHarness, NOW, U } from '../testing/leave-harness';
import { DELETED_USER_NAME } from './leave-dto';

const id = (n: number) => `00000000-0000-7000-8000-0000000d${n.toString().padStart(4, '0')}`;
const at = (minutes: number) => new Date(new Date(NOW).getTime() + minutes * 60_000);
const annual = (
  startDate: string,
  endDate = startDate,
  dayPart: 'FULL' | 'AM' | 'PM' = 'FULL',
) => ({
  type: 'ANNUAL' as const,
  startDate,
  endDate,
  dayPart,
});

describe('LeaveQueries — danh sách đơn (thiết kế §5)', () => {
  it('listMine: chỉ đơn của chính người gọi trong ws, mới nhất trước, có reason + user/decidedBy + days tính khi đọc', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), createdAt: at(1), startDate: '2026-11-23', endDate: '2026-11-24' });
    await h.seed({
      id: id(2),
      createdAt: at(2),
      status: 'APPROVED',
      decidedBy: U.Hana,
      decidedAt: at(3),
      reason: null,
    });
    await h.seed({ id: id(3), createdAt: at(3), userId: U.Max });
    const page = await h.queries.listMine(h.as(U.Mia), { limit: 20 });
    expect(page.items.map((r) => r.id)).toEqual([id(2), id(1)]);
    expect(page.items[0]).toMatchObject({
      user: { id: U.Mia, fullName: 'Mia' },
      decidedBy: { id: U.Hana, fullName: 'Hana' },
      reason: null,
      days: 1,
    });
    expect(page.items[1]).toMatchObject({ reason: 'việc riêng', days: 2, decidedBy: null });
    expect(page.page).toEqual({ nextCursor: null, hasMore: false, limit: 20 });
  });

  it('listMine lọc status; Vic (Admin, không phải nhân viên) ⇒ 403; Otto (không thuộc công ty) ⇒ 401', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), status: 'REJECTED' });
    await h.seed({ id: id(2), startDate: '2026-11-25', endDate: '2026-11-25' });
    const page = await h.queries.listMine(h.as(U.Mia), { status: 'REJECTED', limit: 20 });
    expect(page.items.map((r) => r.id)).toEqual([id(1)]);
    await expect(h.queries.listMine(h.as(U.Vic), { limit: 20 })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(h.queries.listMine(h.as(U.Otto), { limit: 20 })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('phân trang keyset: trùng createdAt vẫn ổn định theo id; trang 2 nối đúng; cursor của endpoint khác / hỏng ⇒ 400', async () => {
    const h = await createLeaveHarness();
    for (const n of [1, 2, 3]) {
      await h.seed({
        id: id(n),
        startDate: `2026-11-2${String(n)}`,
        endDate: `2026-11-2${String(n)}`,
      });
    }
    const p1 = await h.queries.listMine(h.as(U.Mia), { limit: 2 });
    expect(p1.items.map((r) => r.id)).toEqual([id(3), id(2)]);
    expect(p1.page.hasMore).toBe(true);
    const cursor = p1.page.nextCursor ?? '';
    const p2 = await h.queries.listMine(h.as(U.Mia), { limit: 2, cursor });
    expect(p2.items.map((r) => r.id)).toEqual([id(1)]);
    expect(p2.page).toMatchObject({ hasMore: false, nextCursor: null });
    await expect(h.queries.listForHr(h.as(U.Hana), { limit: 2, cursor })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      h.queries.listMine(h.as(U.Mia), { limit: 2, cursor: 'không-phải-cursor' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('listForHr: Mia ⇒ 403; Hana thấy đơn mọi người của công ty, có reason (hr:manage đọc được — B-H2)', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), createdAt: at(1) });
    await h.seed({ id: id(2), createdAt: at(2), userId: U.Max, status: 'APPROVED' });
    await expect(h.queries.listForHr(h.as(U.Mia), { limit: 20 })).rejects.toMatchObject({
      statusCode: 403,
    });
    const all = await h.queries.listForHr(h.as(U.Hana), { limit: 20 });
    expect(all.items.map((r) => [r.id, r.user.fullName, r.reason])).toEqual([
      [id(2), 'Max', 'việc riêng'],
      [id(1), 'Mia', 'việc riêng'],
    ]);
    const pending = await h.queries.listForHr(h.as(U.Hana), { status: 'PENDING', limit: 20 });
    expect(pending.items.map((r) => r.id)).toEqual([id(1)]);
  });

  it('LD-09 khi đọc danh sách: HR thêm ngày lễ sau khi duyệt ⇒ days giảm; 1 lần gọi lịch + 1 lần gọi tên cho cả trang (không N+1)', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), status: 'APPROVED', startDate: '2026-11-16', endDate: '2026-11-18' });
    await h.seed({ id: id(2), startDate: '2026-12-01', endDate: '2026-12-01' });
    h.calendar.holidays.add('2026-11-18');
    const before = { calendar: h.calendar.calls.length, users: h.users.calls };
    const page = await h.queries.listMine(h.as(U.Mia), { limit: 20 });
    expect(page.items.find((r) => r.id === id(1))?.days).toBe(2);
    expect(h.calendar.calls.length - before.calendar).toBe(1);
    expect(h.calendar.calls.at(-1)).toEqual({ from: '2026-11-16', to: '2026-12-01' });
    expect(h.users.calls - before.users).toBe(1);
  });

  it('user đã ẩn danh / không còn bản ghi ⇒ tên thay thế, không lỗi', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), status: 'APPROVED', decidedBy: U.Rex, decidedAt: at(1) });
    h.users.names.delete(U.Rex);
    const [dto] = (await h.queries.listMine(h.as(U.Mia), { limit: 20 })).items;
    expect(dto?.decidedBy).toEqual({ id: U.Rex, fullName: DELETED_USER_NAME });
  });
});

describe('LeaveQueries — số dư của tôi (LB-01/02/08)', () => {
  it('năm chưa có bản ghi ⇒ 12 ngày; GET KHÔNG tạo bản ghi (không ghi trong request đọc)', async () => {
    const h = await createLeaveHarness();
    await expect(h.queries.myBalance(h.as(U.Mia), 2026)).resolves.toMatchObject({
      year: 2026,
      entitledDays: 12,
      adjustmentDays: 0,
      usedDays: 0,
      pendingDays: 0,
      remainingDays: 12,
    });
    expect(await h.readModel.findBalance(U.Mia, 2026)).toBeNull();
  });

  it('dùng / chờ / điều chỉnh âm ⇒ remaining có thể âm (Q4); đơn SICK không trừ; năm khác không tính', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), status: 'APPROVED', startDate: '2026-11-02', endDate: '2026-11-07' }); // 6 ngày
    await h.seed({ id: id(2), startDate: '2026-11-23', endDate: '2026-11-23', dayPart: 'AM' }); // 0,5 chờ
    await h.seed({
      id: id(3),
      type: 'SICK',
      status: 'APPROVED',
      startDate: '2026-11-09',
      endDate: '2026-11-09',
    });
    await h.seed({ id: id(4), status: 'APPROVED', startDate: '2027-01-04', endDate: '2027-01-04' });
    await h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2026, adjustment: -14 }); // nửa ngày
    await expect(h.queries.myBalance(h.as(U.Mia), 2026)).resolves.toMatchObject({
      year: 2026,
      entitledDays: 12,
      adjustmentDays: -7,
      usedDays: 6,
      pendingDays: 0.5,
      remainingDays: -1.5,
    });
  });

  it('Vic ⇒ 403', async () => {
    const h = await createLeaveHarness();
    await expect(h.queries.myBalance(h.as(U.Vic), 2026)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('LeaveQueries — preview (TL duyệt)', () => {
  it('ANNUAL 2 ngày ⇒ { days 2, remainingDays 12 } (số dư TRƯỚC đơn); không khóa, không ghi gì', async () => {
    const h = await createLeaveHarness();
    await expect(
      h.queries.preview(h.as(U.Mia), annual('2026-11-23', '2026-11-24')),
    ).resolves.toEqual({ days: 2, remainingDays: 12 });
    expect(h.locks).toEqual([]);
    expect(await h.rows()).toEqual([]);
    expect(await h.readModel.findBalance(U.Mia, 2026)).toBeNull();
    expect(h.notifier.sent).toEqual([]);
    expect(h.audit.entries).toEqual([]);
  });

  it('không phải ANNUAL ⇒ remainingDays null, không kiểm số dư', async () => {
    const h = await createLeaveHarness();
    await h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2026, adjustment: -24 });
    await expect(
      h.queries.preview(h.as(U.Mia), { ...annual('2026-11-23', '2026-11-23', 'PM'), type: 'SICK' }),
    ).resolves.toEqual({ days: 0.5, remainingDays: null });
  });

  it('lỗi giống submit: NO_WORKING_DAYS, LEAVE_SPANS_YEARS, overlapping_leave (kèm requestId), INSUFFICIENT_BALANCE; Vic 403', async () => {
    const h = await createLeaveHarness();
    const mia = h.as(U.Mia);
    await expect(h.queries.preview(mia, annual('2026-11-15'))).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'NO_WORKING_DAYS' },
    });
    await expect(h.queries.preview(mia, annual('2026-12-30', '2027-01-02'))).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'LEAVE_SPANS_YEARS' },
    });
    await h.seed({ id: id(1), startDate: '2026-11-24', endDate: '2026-11-24' });
    await expect(h.queries.preview(mia, annual('2026-11-23', '2026-11-25'))).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'overlapping_leave', requestId: id(1) },
    });
    await expect(h.queries.preview(mia, annual('2026-11-30', '2026-12-31'))).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'INSUFFICIENT_BALANCE' },
    });
    await expect(h.queries.preview(h.as(U.Vic), annual('2026-11-23'))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe('LeaveQueries — ApprovedLeavePort cho attendance (thiết kế §4)', () => {
  it('chỉ APPROVED, cắt theo [from, to], mọi ngày lịch biểu kể cả CN, giữ AM/PM; lọc userIds; tenant', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), status: 'APPROVED', startDate: '2026-11-14', endDate: '2026-11-16' });
    await h.seed({
      id: id(2),
      status: 'APPROVED',
      userId: U.Max,
      startDate: '2026-11-20',
      endDate: '2026-11-20',
      dayPart: 'AM',
    });
    await h.seed({ id: id(3), startDate: '2026-11-18', endDate: '2026-11-18' }); // PENDING
    await h.seed({ id: id(4), status: 'REVOKED', startDate: '2026-11-19', endDate: '2026-11-19' });
    const all = await h.queries.approvedLeaves({
      from: '2026-11-15',
      to: '2026-11-30',
    });
    expect(all).toEqual([
      { userId: U.Mia, date: '2026-11-15', part: 'FULL' },
      { userId: U.Mia, date: '2026-11-16', part: 'FULL' },
      { userId: U.Max, date: '2026-11-20', part: 'AM' },
    ]);
    await expect(
      h.queries.approvedLeaves({
        userIds: [U.Max],
        from: '2026-11-01',
        to: '2026-11-30',
      }),
    ).resolves.toEqual([{ userId: U.Max, date: '2026-11-20', part: 'AM' }]);
    await expect(
      h.queries.approvedLeaves({
        userIds: [],
        from: '2026-11-01',
        to: '2026-11-30',
      }),
    ).resolves.toEqual([]);
  });

  it('T-052 hai đơn nửa ngày AM (ANNUAL) + PM (UNPAID) cùng ngày ⇒ HAI dòng — attendance tự gộp thành cả ngày', async () => {
    const h = await createLeaveHarness();
    await h.seed({
      id: id(1),
      status: 'APPROVED',
      type: 'ANNUAL',
      startDate: '2026-11-24',
      endDate: '2026-11-24',
      dayPart: 'AM',
    });
    await h.seed({
      id: id(2),
      status: 'APPROVED',
      type: 'UNPAID',
      startDate: '2026-11-24',
      endDate: '2026-11-24',
      dayPart: 'PM',
    });
    const rows = await h.queries.approvedLeaves({
      userIds: [U.Mia],
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { userId: U.Mia, date: '2026-11-24', part: 'AM' },
        { userId: U.Mia, date: '2026-11-24', part: 'PM' },
      ]),
    );
  });
});

describe('Lý do nghỉ tùy chọn (TL: trim, rỗng ⇒ null; ≤ 1000 ở contracts)', () => {
  it.each([
    [undefined, null],
    [null, null],
    ['   ', null],
    ['  ốm  ', 'ốm'],
  ])('submit reason %j ⇒ %j', async (reason, expected) => {
    const h = await createLeaveHarness();
    const dto = await h.leave.submit(h.as(U.Mia), { ...annual('2026-11-23'), reason });
    expect(dto.reason).toBe(expected);
    expect((await h.rows())[0]?.reason).toBe(expected);
  });
});

describe('LeaveQueries — số dư cả công ty (HR, GET leave/balances?year=)', () => {
  it('mọi nhân viên hiện tại (không Admin, không người đã nghỉ), sắp theo tên; người chưa có dòng ⇒ 12; không tạo dòng', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), status: 'APPROVED', startDate: '2026-11-23', endDate: '2026-11-24' });
    await h.seed({
      id: id(2),
      userId: U.Max,
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      dayPart: 'PM',
    });
    await h.seed({ id: id(3), userId: U.Rex, status: 'APPROVED' }); // đã rời
    await h.leave.adjustBalance(h.as(U.Olivia), { userId: U.Pam, year: 2026, adjustment: 3 });
    const page = await h.queries.listBalances(h.as(U.Hana), { year: 2026, limit: 50 });
    expect(page.items.map((r) => r.user.fullName)).toEqual(['Hana', 'Max', 'Mia', 'Pam']);
    expect(page.items.find((r) => r.userId === U.Mia)).toMatchObject({
      year: 2026,
      usedDays: 2,
      remainingDays: 10,
    });
    expect(page.items.find((r) => r.userId === U.Max)).toMatchObject({
      pendingDays: 0.5,
      remainingDays: 11.5,
    });
    expect(page.items.find((r) => r.userId === U.Pam)).toMatchObject({
      adjustmentDays: 1.5,
      remainingDays: 13.5,
    });
    expect(await h.readModel.findBalance(U.Hana, 2026)).toBeNull();
  });

  it('phân trang theo (tên, id); cursor của endpoint khác ⇒ 400; Mia ⇒ 403', async () => {
    const h = await createLeaveHarness();
    const p1 = await h.queries.listBalances(h.as(U.Hana), { year: 2026, limit: 2 });
    expect(p1.items.map((r) => r.user.fullName)).toEqual(['Hana', 'Max']);
    const cursor = p1.page.nextCursor ?? '';
    const p2 = await h.queries.listBalances(h.as(U.Hana), { year: 2026, limit: 2, cursor });
    expect(p2.items.map((r) => r.user.fullName)).toEqual(['Mia', 'Pam']); // Admin không có
    expect(p2.page).toMatchObject({ hasMore: false, nextCursor: null });
    await expect(h.queries.listMine(h.as(U.Mia), { limit: 2, cursor })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      h.queries.listBalances(h.as(U.Mia), { year: 2026, limit: 2 }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe('leaveSummaries — reader cho notifications (T-040b)', () => {
  it('tra theo id: id lạ không khớp; chỉ loại + ngày, không reason', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: id(1), reason: 'sốt cao' });
    const map = await h.readModel.leaveSummaries([id(1), id(9)]);
    expect([...map.entries()]).toEqual([
      [id(1), { type: 'ANNUAL', startDate: '2026-11-23', endDate: '2026-11-23' }],
    ]);
  });
});
