import { AttendanceMonthDto, AttendanceTodayDto } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { instantOf } from '../../domain/local-time';
import {
  createAttendanceHarness,
  key,
  MAX,
  MIA,
  S0,
  VN,
  W1,
} from '../../testing/attendance-harness';
import { CheckInOutUseCase } from './check-in-out.use-case';
import { lastDayOf } from './my-attendance.queries';

// test-spec-hr §5 (tầng A): AT-01..AT-05, AT-07, AT-08, AT-21. Giờ = giờ VN (lịch S0).
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const setup = createAttendanceHarness;

describe('CheckInOutUseCase', () => {
  it('AT-01 check-in lần đầu: giờ SERVER, nguồn WEB, lưu IP + UA (cắt ≤ 256); thẻ trả về khớp contract', async () => {
    const t = setup();
    const card = await t.punch('IN', key(1));
    expect(t.events.rows).toHaveLength(1);
    expect(t.events.rows[0]).toMatchObject({
      kind: 'IN',
      source: 'WEB',
      workDate: '2026-11-17',
      occurredAt: t.clock.now(),
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      createdBy: MIA,
    });
    expect(AttendanceTodayDto.parse(card)).toEqual(card);
    expect(card).toMatchObject({ status: 'PRESENT', inProgress: true, date: '2026-11-17' });

    const t2 = setup();
    await new CheckInOutUseCase(t2.deps).execute({
      workspaceId: W1,
      userId: MIA,
      kind: 'IN',
      idempotencyKey: key(2),
      ip: null,
      userAgent: 'x'.repeat(400),
    });
    expect(t2.events.rows[0]!.userAgent).toHaveLength(256);
  });

  it('AT-02 check-in lần 2 cùng ngày (key khác) ⇒ 409 already_checked_in, không thêm dòng', async () => {
    const t = setup();
    await t.punch('IN', key(1));
    await expect(t.punch('IN', key(2))).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'already_checked_in' },
    });
    expect(t.events.rows).toHaveLength(1);
  });

  it('AT-03 lặp check-in cùng Idempotency-Key ⇒ trả thẻ hiện tại, không thêm dòng (cùng firstIn)', async () => {
    const t = setup();
    const first = await t.punch('IN', key(1));
    t.clock.advance(60_000);
    const again = await t.punch('IN', key(1));
    expect(t.events.rows).toHaveLength(1);
    expect(again.firstIn).toBe(first.firstIn);
  });

  it('AT-04 cùng key nhưng khác loại (IN rồi OUT) ⇒ 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const t = setup();
    await t.punch('IN', key(1));
    await expect(t.punch('OUT', key(1))).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('AT-05 key của Mia dùng lại bởi Max ⇒ không va (key gắn theo user)', async () => {
    const t = setup();
    await t.punch('IN', key(1));
    await expect(t.punch('IN', key(1), MAX)).resolves.toMatchObject({ status: 'PRESENT' });
    expect(t.events.rows.map((e) => e.userId)).toEqual([MIA, MAX]);
  });

  it('AT-07 check-out khi chưa IN ⇒ 422 NOT_CHECKED_IN', async () => {
    const t = setup('2026-11-17 17:30');
    await expect(t.punch('OUT', key(1))).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'NOT_CHECKED_IN' },
    });
    expect(t.events.rows).toHaveLength(0);
  });

  it('AT-08 check-out 2 lần ⇒ cả hai thành công, lastOut = lượt sau', async () => {
    const t = setup();
    await t.punch('IN', key(1));
    t.at('2026-11-17 12:00');
    await t.punch('OUT', key(2));
    t.at('2026-11-17 17:40');
    const card = await t.punch('OUT', key(3));
    expect(card.lastOut).toBe(instantOf('2026-11-17', hm('17:40'), VN).toISOString());
    expect(card.status).toBe('PRESENT');
  });

  it('OUT sau 00:00 (trước 06:00) gắn vào ngày của IN còn mở; ngày đó PRESENT, 480 phút', async () => {
    const t = setup('2026-11-16 08:00');
    await t.punch('IN', key(1));
    t.at('2026-11-17 00:30');
    await t.punch('OUT', key(2));
    expect(t.events.rows[1]!.workDate).toBe('2026-11-16');
    const month = await t.queries.month({ workspaceId: W1, userId: MIA, month: '2026-11' });
    expect(month.days.find((x) => x.date === '2026-11-16')).toMatchObject({
      status: 'PRESENT',
      workedMin: 480,
    });
  });
});

describe('MyAttendanceQueries', () => {
  it('AT-21 me/today trước khi chấm: đủ trường, lịch + múi giờ của lịch, PENDING (07:55)', async () => {
    const t = setup();
    const card = await t.queries.today({ workspaceId: W1, userId: MIA });
    expect(AttendanceTodayDto.parse(card)).toEqual(card);
    expect(card).toMatchObject({
      timezone: VN,
      date: '2026-11-17',
      isWorkday: true,
      isHoliday: false,
      status: 'PENDING',
      firstIn: null,
      leave: null,
      schedule: { startMin: 480, endMin: 1050, breakStartMin: 720, breakEndMin: 810, graceMin: 0 },
    });
  });

  it('me?month=: đủ mọi ngày của tháng, ngày lễ + nghỉ đã duyệt + Chủ nhật đúng trạng thái; khớp contract', async () => {
    const t = setup('2026-11-30 20:00');
    t.calendar.holidayRows.push({ workspaceId: W1, date: '2026-11-14', name: 'Lễ thử' });
    t.leaves.rows.push({ workspaceId: W1, userId: MIA, date: '2026-11-16', part: 'FULL' });
    const month = await t.queries.month({ workspaceId: W1, userId: MIA, month: '2026-11' });
    expect(AttendanceMonthDto.parse(month)).toEqual(month);
    expect(month.days).toHaveLength(30);
    const of = (date: string) => month.days.find((x) => x.date === date);
    expect(of('2026-11-14')).toMatchObject({ status: 'HOLIDAY', holidayName: 'Lễ thử' });
    expect(of('2026-11-15')).toMatchObject({ status: 'OFF', isWorkday: false });
    expect(of('2026-11-16')).toMatchObject({ status: 'ON_LEAVE', leave: 'FULL' });
    expect(of('2026-11-17')).toMatchObject({ status: 'ABSENT' });
    expect(lastDayOf('2028-02')).toBe('2028-02-29');
  });

  it('workspace chưa lưu lịch nào ⇒ dùng DEFAULT_SCHEDULE (TL: không seed); HR lưu phiên bản mới thì theo phiên bản đó', async () => {
    const t = setup();
    expect(t.calendar.versions).toEqual([]);
    expect(await t.queries.today({ workspaceId: W1, userId: MIA })).toMatchObject({
      timezone: VN,
      isWorkday: true,
      schedule: { startMin: 480, endMin: 1050, breakStartMin: 720, breakEndMin: 810, graceMin: 0 },
    });
    t.calendar.versions.push({ ...S0, effectiveFrom: '2026-11-17', startMin: 540 });
    expect((await t.queries.today({ workspaceId: W1, userId: MIA })).schedule?.startMin).toBe(540);
  });
});
