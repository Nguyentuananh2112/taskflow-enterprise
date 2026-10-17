import { AttendanceCompanyTodayDto, AttendanceMemberMonthDto } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import {
  createAttendanceHarness,
  HANA,
  key,
  MAX,
  MIA,
  OLIVIA,
  vnTime,
  W1,
} from '../../testing/attendance-harness';

// test-spec-hr §5 (tầng A): HR xem cả công ty — AT-20 (người đã rời, R30), AT-22 (tổng tháng), phân trang.
const setup = createAttendanceHarness;
const adjust = (
  t: Awaited<ReturnType<typeof setup>>,
  userId: string,
  kind: 'IN' | 'OUT',
  date: string,
  time: string,
) =>
  t.eventUseCases.adjust(W1, HANA, { userId, kind, date, time, nextDay: false, reason: 'Nhập bù' });
const tenureOf = (
  t: Awaited<ReturnType<typeof setup>>,
  userId: string,
  from: string,
  until: string | null,
) => {
  const rows = t.tenures.rows.filter((r) => r.userId !== userId);
  rows.push({ workspaceId: W1, userId, from: vnTime(from), until: until ? vnTime(until) : null });
  t.tenures.rows.splice(0, t.tenures.rows.length, ...rows);
};

describe('HrAttendanceQueries.today', () => {
  it('mọi nhân viên (không VIEWER), sắp theo tên; trạng thái từng người; khớp contract', async () => {
    const t = await setup();
    await t.punch('IN', key(1));
    const r = await t.hrQueries.today(W1);
    expect(AttendanceCompanyTodayDto.parse(r)).toEqual(r);
    expect(r).toMatchObject({
      date: '2026-11-17',
      timezone: 'Asia/Ho_Chi_Minh',
      isWorkday: true,
      isHoliday: false,
      holidayName: null,
      schedule: { startMin: 480, endMin: 1050 },
    });
    expect(r.members.map((m) => [m.user.fullName, m.left, m.day.status])).toEqual([
      ['Hana', false, 'PENDING'],
      ['Max', false, 'PENDING'],
      ['Mia', false, 'PRESENT'],
      ['Olivia', false, 'PENDING'],
    ]);
    expect(r.members.every((m) => !m.day.notCheckedInYet)).toBe(true); // 07:55 — chưa tới giờ vào ca
  });

  it('tab Hôm nay sau giờ vào ca: người chưa chấm ⇒ PENDING + notCheckedInYet (không phải "Chưa tới giờ")', async () => {
    const t = await setup('2026-11-17 09:00');
    await t.punch('IN', key(1));
    const r = await t.hrQueries.today(W1);
    expect(AttendanceCompanyTodayDto.parse(r)).toEqual(r);
    expect(r.members.map((m) => [m.user.fullName, m.day.status, m.day.notCheckedInYet])).toEqual([
      ['Hana', 'PENDING', true],
      ['Max', 'PENDING', true],
      ['Mia', 'PRESENT', false],
      ['Olivia', 'PENDING', true],
    ]);
  });

  it('T-052 hai đơn nửa ngày AM + PM hôm nay ⇒ ON_LEAVE cả ngày (không PENDING / notCheckedInYet, không vắng ½)', async () => {
    const t = await setup('2026-11-17 18:00');
    // Port trả một dòng mỗi (đơn, ngày); PM trước AM — thứ tự dòng không được quyết định kết quả.
    t.leaves.rows.push(
      { workspaceId: W1, userId: MAX, date: '2026-11-17', part: 'PM' },
      { workspaceId: W1, userId: MAX, date: '2026-11-17', part: 'AM' },
    );
    const r = await t.hrQueries.today(W1);
    const max = r.members.find((m) => m.user.id === MAX)!.day;
    expect(max).toMatchObject({
      status: 'ON_LEAVE',
      leave: 'FULL',
      absentHalf: false,
      notCheckedInYet: false,
    });
  });

  it('ngày lễ ⇒ isHoliday + tên; người đã rời có lượt hôm nay vẫn hiện, gắn left', async () => {
    const t = await setup('2026-11-17 10:00');
    await t.backend.addHoliday(W1, '2026-11-17', 'Lễ thử');
    await adjust(t, MAX, 'IN', '2026-11-17', '08:00');
    tenureOf(t, MAX, '2020-01-01 09:00', '2026-11-17 09:00');
    tenureOf(t, MIA, '2020-01-01 09:00', '2026-11-10 17:00');
    const r = await t.hrQueries.today(W1);
    expect(r).toMatchObject({ isHoliday: true, holidayName: 'Lễ thử' });
    expect(r.members.map((m) => [m.user.fullName, m.left, m.day.status])).toEqual([
      ['Hana', false, 'HOLIDAY'],
      ['Max', true, 'HOLIDAY'],
      ['Olivia', false, 'HOLIDAY'],
    ]);
  });
});

describe('HrAttendanceQueries.month', () => {
  it('AT-20 người đã rời trong tháng ⇒ có dòng, left, ngày sau khi rời NOT_EMPLOYED; rời từ tháng trước, không lượt ⇒ không có dòng', async () => {
    const t = await setup('2026-11-30 20:00');
    await adjust(t, MAX, 'IN', '2026-11-05', '08:00');
    tenureOf(t, MAX, '2020-01-01 09:00', '2026-11-10 17:00');
    tenureOf(t, OLIVIA, '2020-01-01 09:00', '2026-10-20 17:00');
    const r = await t.hrQueries.month(W1, { month: '2026-11', limit: 50 });
    expect(r.data.map((x) => [x.user.fullName, x.left])).toEqual([
      ['Hana', false],
      ['Max', true],
      ['Mia', false],
    ]);
    const max = r.data[1]!;
    expect(AttendanceMemberMonthDto.parse(max)).toEqual(max);
    expect(max.days).toHaveLength(30);
    expect(max.days.find((x) => x.date === '2026-11-10')!.status).toBe('ABSENT');
    expect(max.days.find((x) => x.date === '2026-11-11')!.status).toBe('NOT_EMPLOYED');
    // 1..10/11: 8 ngày công (CN 1/11, 8/11 nghỉ), 5/11 có IN ⇒ MISSING_OUT; vắng 7 ngày.
    expect(max.totals).toMatchObject({ absentDays: 7, missingOutDays: 1 });
    expect(r.page).toEqual({ nextCursor: null, hasMore: false, limit: 50 });
  });

  it('AT-22 tổng tháng: gia nhập 10/11 ⇒ không đếm vắng trước đó; lễ / CN / nghỉ nửa ngày / đi muộn tính đúng', async () => {
    const t = await setup('2026-11-30 20:00');
    tenureOf(t, MIA, '2026-11-10 14:00', null);
    await t.backend.addHoliday(W1, '2026-11-20', 'Lễ');
    t.leaves.rows.push({ workspaceId: W1, userId: MIA, date: '2026-11-12', part: 'AM' });
    await adjust(t, MIA, 'IN', '2026-11-11', '08:10');
    await adjust(t, MIA, 'OUT', '2026-11-11', '17:30');
    const r = await t.hrQueries.month(W1, { month: '2026-11', limit: 50 });
    const mia = r.data.find((x) => x.user.id === MIA)!;
    // 10..30/11: 21 ngày − 3 CN = 18 ngày công; −1 lễ, −1 đi làm, 12/11 vắng nửa ngày ⇒ 15,5.
    expect(mia.totals).toEqual({
      workedMin: 470,
      lateDays: 1,
      lateMin: 10,
      earlyDays: 0,
      earlyMin: 0,
      absentDays: 15.5,
      leaveDays: 0.5,
      missingOutDays: 0,
      presentDays: 1,
      upcomingLeaveDays: 0,
      throughDate: '2026-11-30',
    });
    expect(mia.days.filter((x) => x.status === 'NOT_EMPLOYED')).toHaveLength(9);
  });

  it('T-046 giữa tháng: chỉ đếm tới HÔM NAY; phép sau hôm nay ⇒ upcomingLeaveDays; tổng của HR = tổng của me?month', async () => {
    const t = await setup('2026-11-17 10:00');
    t.leaves.rows.push(
      { workspaceId: W1, userId: MIA, date: '2026-11-16', part: 'FULL' },
      { workspaceId: W1, userId: MIA, date: '2026-11-20', part: 'FULL' },
      { workspaceId: W1, userId: MIA, date: '2026-11-23', part: 'PM' },
    );
    t.at('2026-11-17 08:10');
    await t.punch('IN', key(1)); // hôm nay vào muộn, đang làm
    t.at('2026-11-17 10:00');
    const r = await t.hrQueries.month(W1, { month: '2026-11', limit: 50 });
    const mia = r.data.find((x) => x.user.id === MIA)!;
    // 1..17/11: CN 1/11, 8/11, 15/11 nghỉ; 2..7, 9..14 = 12 ngày vắng; 16/11 phép; 17/11 đi làm (muộn 10').
    expect(mia.totals).toEqual({
      workedMin: 0, // hôm nay chưa ra ⇒ chưa cộng
      lateDays: 1,
      lateMin: 10,
      earlyDays: 0,
      earlyMin: 0,
      absentDays: 12,
      leaveDays: 1,
      missingOutDays: 0,
      presentDays: 1,
      upcomingLeaveDays: 1.5,
      throughDate: '2026-11-17',
    });
    const mine = await t.queries.month({ workspaceId: W1, userId: MIA, month: '2026-11' });
    expect(mine.totals).toEqual(mia.totals);
  });

  it('T-052 AM + PM cùng ngày (hai đơn, có thể khác loại) ⇒ nghỉ cả ngày: leaveDays 1, không vắng; tổng HR = me?month', async () => {
    const t = await setup('2026-11-30 20:00');
    tenureOf(t, MIA, '2026-11-23 08:00', null);
    t.leaves.rows.push(
      { workspaceId: W1, userId: MIA, date: '2026-11-24', part: 'AM' },
      { workspaceId: W1, userId: MIA, date: '2026-11-24', part: 'PM' },
      // hai dòng cùng phần (một đơn nhiều ngày trùng ngày với đơn khác không thể có — D-M2) vẫn là nửa ngày
      { workspaceId: W1, userId: MIA, date: '2026-11-25', part: 'PM' },
      { workspaceId: W1, userId: MIA, date: '2026-11-25', part: 'PM' },
    );
    const r = await t.hrQueries.month(W1, { month: '2026-11', limit: 50 });
    const mia = r.data.find((x) => x.user.id === MIA)!;
    expect(mia.days.find((x) => x.date === '2026-11-24')).toMatchObject({
      status: 'ON_LEAVE',
      leave: 'FULL',
      absentHalf: false,
    });
    expect(mia.days.find((x) => x.date === '2026-11-25')).toMatchObject({
      status: 'ABSENT',
      leave: 'PM',
      absentHalf: true,
    });
    // 23..30/11: CN 29/11 nghỉ ⇒ 7 ngày công; 24/11 phép cả ngày, 25/11 vắng ½ + phép ½ ⇒ vắng 5,5.
    expect(mia.totals).toMatchObject({ absentDays: 5.5, leaveDays: 1.5, presentDays: 0 });
    const mine = await t.queries.month({ workspaceId: W1, userId: MIA, month: '2026-11' });
    expect(mine.totals).toEqual(mia.totals);
  });

  it('phân trang: limit 2 ⇒ 2 trang theo tên, cursor opaque; cursor hỏng / của endpoint khác ⇒ 400', async () => {
    const t = await setup('2026-11-30 20:00');
    const p1 = await t.hrQueries.month(W1, { month: '2026-11', limit: 2 });
    expect(p1.data.map((x) => x.user.fullName)).toEqual(['Hana', 'Max']);
    expect(p1.page).toMatchObject({ hasMore: true, limit: 2 });
    expect(p1.page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const p2 = await t.hrQueries.month(W1, {
      month: '2026-11',
      limit: 2,
      cursor: p1.page.nextCursor!,
    });
    expect(p2.data.map((x) => x.user.fullName)).toEqual(['Mia', 'Olivia']);
    expect(p2.page).toEqual({ nextCursor: null, hasMore: false, limit: 2 });
    const other = Buffer.from(JSON.stringify({ k: 'tasks', v: { name: 'x', id: 'y' } })).toString(
      'base64url',
    );
    for (const cursor of ['abc', other]) {
      await expect(
        t.hrQueries.month(W1, { month: '2026-11', limit: 2, cursor }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
  });
});
