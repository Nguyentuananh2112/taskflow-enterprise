import { WorkScheduleDto } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import {
  createAttendanceHarness,
  HANA,
  MIA,
  OLIVIA,
  S0,
  W1,
  W2,
} from '../../testing/attendance-harness';

// test-spec-hr §5 (tầng A): AT-17, AT-17b, AT-17c, AT-18 + ngày lễ idempotent. Đồng hồ: 17/11/2026 07:55 VN.
const { effectiveFrom: _e, ...shift } = S0;
const body = (over: Partial<typeof S0> = {}) => ({
  ...shift,
  effectiveFrom: '2026-11-17',
  ...over,
});
const setup = createAttendanceHarness;

describe('WorkCalendarUseCases — lịch theo phiên bản', () => {
  it('AT-17 effectiveFrom < hôm nay ⇒ 422 SCHEDULE_IN_PAST, không ghi; = hôm nay ⇒ lưu, thẻ hôm nay theo lịch mới', async () => {
    const t = await setup();
    await expect(
      t.calendarUseCases.createSchedule(W1, HANA, body({ effectiveFrom: '2026-11-16' })),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'BUSINESS_RULE_VIOLATION',
      details: { rule: 'SCHEDULE_IN_PAST' },
    });
    expect(await t.calendarUseCases.listSchedules(W1)).toEqual([]);
    expect(t.audit).toEqual([]);
    const dto = await t.calendarUseCases.createSchedule(W1, HANA, body({ startMin: 540 }));
    expect(WorkScheduleDto.parse(dto)).toEqual(dto);
    expect(dto).toMatchObject({ effectiveFrom: '2026-11-17', startMin: 540 });
    expect((await t.queries.today({ workspaceId: W1, userId: MIA })).schedule?.startMin).toBe(540);
  });

  it('AT-17 "hôm nay" theo múi giờ của lịch: 00:30 ngày 18 giờ VN (= 17:30Z ngày 17) ⇒ 17/11 đã là quá khứ', async () => {
    const t = await setup('2026-11-18 00:30');
    await expect(
      t.calendarUseCases.createSchedule(W1, HANA, body({ effectiveFrom: '2026-11-17' })),
    ).rejects.toMatchObject({ details: { rule: 'SCHEDULE_IN_PAST' } });
    await expect(
      t.calendarUseCases.createSchedule(W1, HANA, body({ effectiveFrom: '2026-11-18' })),
    ).resolves.toMatchObject({ effectiveFrom: '2026-11-18' });
  });

  it('AT-17b đọc me/today khi chưa lưu lịch ⇒ KHÔNG tạo dòng lịch nào (0 trước, 0 sau)', async () => {
    const t = await setup();
    expect(await t.calendarUseCases.listSchedules(W1)).toEqual([]);
    await t.queries.today({ workspaceId: W1, userId: MIA });
    await t.queries.month({ workspaceId: W1, userId: MIA, month: '2026-11' });
    expect(await t.calendarUseCases.listSchedules(W1)).toEqual([]);
  });

  it('AT-17c lưu lần đầu ⇒ đúng 1 dòng, createdBy = HR, audit SCHEDULE_SET (before null); lưu lại cùng ngày ⇒ THAY (before = bản cũ)', async () => {
    const t = await setup();
    await t.calendarUseCases.createSchedule(W1, HANA, body());
    expect(await t.calendarUseCases.listSchedules(W1)).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-11-17',
        createdBy: { id: HANA, fullName: 'Hana' },
        createdAt: t.clock.now().toISOString(),
      }),
    ]);
    expect(t.audit).toEqual([
      expect.objectContaining({
        action: 'SCHEDULE_SET',
        actorId: HANA,
        targetUserId: null,
        before: null,
        after: { ...shift, effectiveFrom: '2026-11-17' },
      }),
    ]);
    await t.calendarUseCases.createSchedule(W1, OLIVIA, body({ graceMin: 5 }));
    const list = await t.calendarUseCases.listSchedules(W1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ graceMin: 5, createdBy: { id: OLIVIA } });
    expect(t.audit[1]).toMatchObject({
      before: { graceMin: 0, effectiveFrom: '2026-11-17' },
      after: { graceMin: 5 },
    });
  });

  it('danh sách sắp effectiveFrom tăng dần; mỗi workspace riêng; không phải thành viên ⇒ 404 workspace', async () => {
    const t = await setup();
    await t.calendarUseCases.createSchedule(W1, HANA, body({ effectiveFrom: '2026-12-01' }));
    await t.calendarUseCases.createSchedule(W1, HANA, body({ timezone: 'Europe/Berlin' }));
    expect((await t.calendarUseCases.listSchedules(W1)).map((s) => s.effectiveFrom)).toEqual([
      '2026-11-17',
      '2026-12-01',
    ]);
    expect(await t.calendarUseCases.listSchedules(W2)).toEqual([]);
    await expect(t.calendarUseCases.createSchedule(W2, HANA, body())).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'workspace' },
    });
  });
});

describe('WorkCalendarUseCases — ngày lễ', () => {
  it('AT-18 ngày đã qua: Hana ⇒ 422 HOLIDAY_IN_PAST (kể cả có lý do); Olivia thiếu lý do ⇒ 422 REASON_REQUIRED; Olivia + lý do ⇒ 200 + HrAuditLog', async () => {
    const t = await setup();
    for (const reason of [undefined, 'Nhập bù']) {
      await expect(
        t.calendarUseCases.putHoliday(W1, HANA, '2026-11-16', { name: 'Lễ', reason }),
      ).rejects.toMatchObject({ statusCode: 422, details: { rule: 'HOLIDAY_IN_PAST' } });
    }
    await expect(
      t.calendarUseCases.putHoliday(W1, OLIVIA, '2026-11-16', { name: 'Lễ' }),
    ).rejects.toMatchObject({ statusCode: 422, details: { rule: 'REASON_REQUIRED' } });
    expect(await t.calendarUseCases.listHolidays(W1, 2026)).toEqual([]);
    expect(t.audit).toEqual([]);
    await expect(
      t.calendarUseCases.putHoliday(W1, OLIVIA, '2026-11-16', { name: 'Lễ', reason: 'Nhập bù' }),
    ).resolves.toEqual({ date: '2026-11-16', name: 'Lễ' });
    expect(t.audit).toEqual([
      expect.objectContaining({
        action: 'HOLIDAY_SET',
        actorId: OLIVIA,
        before: null,
        after: { date: '2026-11-16', name: 'Lễ', note: 'Nhập bù' },
      }),
    ]);
    const month = await t.queries.month({ workspaceId: W1, userId: MIA, month: '2026-11' });
    expect(month.days.find((x) => x.date === '2026-11-16')).toMatchObject({ status: 'HOLIDAY' });
  });

  it('hôm nay / tương lai: HR tự do, không cần lý do; đổi tên ⇒ audit before = tên cũ; danh sách theo năm, sắp theo ngày', async () => {
    const t = await setup();
    await t.calendarUseCases.putHoliday(W1, HANA, '2027-01-01', { name: 'Tết Dương lịch' });
    await t.calendarUseCases.putHoliday(W1, HANA, '2026-12-31', { name: 'Cuối năm' });
    await t.calendarUseCases.putHoliday(W1, HANA, '2026-11-17', { name: 'A' });
    await t.calendarUseCases.putHoliday(W1, HANA, '2026-11-17', { name: 'B' });
    expect(await t.calendarUseCases.listHolidays(W1, 2026)).toEqual([
      { date: '2026-11-17', name: 'B' },
      { date: '2026-12-31', name: 'Cuối năm' },
    ]);
    expect(await t.calendarUseCases.listHolidays(W1, 2027)).toEqual([
      { date: '2027-01-01', name: 'Tết Dương lịch' },
    ]);
    expect(t.audit[3]).toMatchObject({
      action: 'HOLIDAY_SET',
      before: { date: '2026-11-17', name: 'A' },
      after: { date: '2026-11-17', name: 'B' },
    });
  });

  it('DELETE idempotent: không có lễ ⇒ không lỗi, không audit; có ⇒ xóa + HOLIDAY_DELETE; ngày đã qua theo luật AT-18', async () => {
    const t = await setup();
    await t.calendarUseCases.deleteHoliday(W1, HANA, '2026-12-02', undefined);
    expect(t.audit).toEqual([]);
    await t.calendarUseCases.putHoliday(W1, HANA, '2026-12-02', { name: 'Nghỉ bù' });
    await t.calendarUseCases.deleteHoliday(W1, HANA, '2026-12-02', undefined);
    expect(await t.calendarUseCases.listHolidays(W1, 2026)).toEqual([]);
    expect(t.audit[1]).toMatchObject({
      action: 'HOLIDAY_DELETE',
      before: { date: '2026-12-02', name: 'Nghỉ bù' },
      after: null,
    });
    await t.backend.addHoliday(W1, '2026-09-02', 'Quốc khánh');
    await expect(
      t.calendarUseCases.deleteHoliday(W1, HANA, '2026-09-02', 'x'),
    ).rejects.toMatchObject({ details: { rule: 'HOLIDAY_IN_PAST' } });
    await expect(
      t.calendarUseCases.deleteHoliday(W1, OLIVIA, '2026-09-02', undefined),
    ).rejects.toMatchObject({ details: { rule: 'REASON_REQUIRED' } });
    await t.calendarUseCases.deleteHoliday(W1, OLIVIA, '2026-09-02', 'Nhập nhầm');
    expect(t.audit[2]).toMatchObject({ action: 'HOLIDAY_DELETE', after: { note: 'Nhập nhầm' } });
    expect(await t.calendarUseCases.listHolidays(W1, 2026)).toEqual([]);
  });

  it('"hôm nay" theo múi giờ LỊCH: lịch Los Angeles ⇒ 07:55 VN 17/11 là 16:55 ngày 16/11 ⇒ 16/11 chưa qua', async () => {
    const t = await setup();
    await expect(
      t.calendarUseCases.putHoliday(W1, HANA, '2026-11-16', { name: 'X' }),
    ).rejects.toMatchObject({ details: { rule: 'HOLIDAY_IN_PAST' } });
    await t.backend.addScheduleVersion(
      W1,
      { ...S0, effectiveFrom: '2026-01-01', timezone: 'America/Los_Angeles' },
      HANA,
    );
    await expect(
      t.calendarUseCases.putHoliday(W1, HANA, '2026-11-16', { name: 'X' }),
    ).resolves.toEqual({ date: '2026-11-16', name: 'X' });
  });
});
