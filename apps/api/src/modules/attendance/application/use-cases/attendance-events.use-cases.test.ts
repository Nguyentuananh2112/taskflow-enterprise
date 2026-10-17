import { AttendanceEventChangeDto, AttendanceEventsDto } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import {
  createAttendanceHarness,
  HANA,
  key,
  MAX,
  MIA,
  OLIVIA,
  vnTime,
} from '../../testing/attendance-harness';

// test-spec-hr §5 (tầng A): AT-12..AT-16, AT-20 + route của chính nhân viên (§5, NĐ 13 Đ.14).
const hana = HANA;
const olivia = OLIVIA;
const adjustBody = (over: Record<string, unknown> = {}) => ({
  userId: MIA,
  kind: 'IN' as const,
  date: '2026-11-17',
  time: '08:00',
  nextDay: false,
  reason: 'Quên chấm vào',
  ...over,
});

describe('AttendanceEventsUseCases', () => {
  it('AT-12 Hana thêm ADJUSTMENT cho Mia ⇒ { event, day }, source ADJUSTMENT, createdBy Hana, audit + thông báo cho Mia', async () => {
    const t = await createAttendanceHarness('2026-11-17 10:00');
    const r = await t.eventUseCases.adjust(hana, adjustBody());
    expect(AttendanceEventChangeDto.parse(r)).toEqual(r);
    expect(r.event).toMatchObject({
      userId: MIA,
      kind: 'IN',
      source: 'ADJUSTMENT',
      workDate: '2026-11-17',
      occurredAt: vnTime('2026-11-17 08:00').toISOString(),
      note: 'Quên chấm vào',
      createdBy: { id: HANA, fullName: 'Hana' },
      ip: null,
    });
    expect(r.day).toMatchObject({ date: '2026-11-17', firstIn: r.event.occurredAt });
    // T-046 (TL d9): tổng tháng của người đó do SERVER tính (web không tự cộng) — khớp me?month.
    const month = await t.queries.month({ userId: MIA, month: '2026-11' });
    expect(r.totals).toEqual(month.totals);
    expect(r.totals).toMatchObject({ presentDays: 1, throughDate: '2026-11-17' });
    expect(t.audit).toEqual([
      expect.objectContaining({
        action: 'EVENT_ADJUST',
        actorId: HANA,
        targetUserId: MIA,
        refId: r.event.id,
      }),
    ]);
    expect(t.notified).toEqual([{ recipientId: MIA, eventId: r.event.id, actorId: HANA }]);
  });

  it('ADJUSTMENT OUT sau nửa đêm: nextDay ⇒ giờ 00:30 hôm sau nhưng vẫn thuộc ngày nhập', async () => {
    const t = await createAttendanceHarness('2026-11-18 10:00');
    const r = await t.eventUseCases.adjust(
      hana,
      adjustBody({ kind: 'OUT', date: '2026-11-17', time: '00:30', nextDay: true }),
    );
    expect(r.event).toMatchObject({
      workDate: '2026-11-17',
      occurredAt: vnTime('2026-11-18 00:30').toISOString(),
    });
    // Tổng của THÁNG chứa workDate (không phải tháng của occurredAt).
    expect(r.totals.throughDate).toBe('2026-11-18');
  });

  it('AT-13 luật self TUYỆT ĐỐI (company-level ADR-134): Hana tự điều chỉnh ⇒ 403; Admin (Olivia) điều chỉnh cho Hana ⇒ được + audit + thông báo Hana', async () => {
    const t = await createAttendanceHarness('2026-11-17 10:00');
    await expect(t.eventUseCases.adjust(hana, adjustBody({ userId: HANA }))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await t.backend.eventRows()).toHaveLength(0);
    const r = await t.eventUseCases.adjust(olivia, adjustBody({ userId: HANA }));
    expect(r.event.createdBy).toEqual({ id: OLIVIA, fullName: 'Olivia' });
    expect(t.audit.map((a) => a.action)).toEqual(['EVENT_ADJUST']);
    expect(t.notified.map((n) => n.recipientId)).toEqual([HANA]);
  });

  it('A S2: ADJUSTMENT theo NHIỆM KỲ — chưa từng là nhân viên (Admin) ⇒ 404 user; đã nghỉ, ngày trong nhiệm kỳ cũ ⇒ được; ngày sau ngày cuối ⇒ 422 NOT_EMPLOYED', async () => {
    const t = await createAttendanceHarness('2026-11-17 10:00');
    await expect(
      t.eventUseCases.adjust(hana, adjustBody({ userId: OLIVIA })),
    ).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'user' },
    });
    // Mia nghỉ việc, ngày cuối 15/11 (không còn dòng company_members — chỉ còn nhiệm kỳ cũ).
    t.members.delete(MIA);
    t.tenures.rows.splice(
      t.tenures.rows.findIndex((r) => r.userId === MIA),
      1,
      {
        userId: MIA,
        from: '2020-01-01',
        until: '2026-11-15',
      },
    );
    const ok = await t.eventUseCases.adjust(hana, adjustBody({ date: '2026-11-15' }));
    expect(ok.event.kind).toBe('IN');
    await expect(
      t.eventUseCases.adjust(hana, adjustBody({ date: '2026-11-16' })),
    ).rejects.toMatchObject({ statusCode: 422, details: { rule: 'NOT_EMPLOYED' } });
    expect(await t.backend.eventRows()).toHaveLength(1);
  });

  it('AT-14 void có lý do ⇒ 200 { event, day }, voidedAt/By/Reason, dòng KHÔNG bị xóa; void lần 2 ⇒ 409 already_voided', async () => {
    const t = await createAttendanceHarness();
    await t.punch('IN', key(1));
    const id = (await t.backend.eventRows())[0]!.id;
    t.at('2026-11-17 10:00');
    const r = await t.eventUseCases.void(hana, { id, reason: 'Bấm hộ' });
    expect(AttendanceEventChangeDto.parse(r)).toEqual(r);
    expect(r.event).toMatchObject({
      id,
      voidedBy: { id: HANA, fullName: 'Hana' },
      voidReason: 'Bấm hộ',
      voidedAt: vnTime('2026-11-17 10:00').toISOString(),
    });
    expect(r.day.firstIn).toBeNull();
    // Hủy IN duy nhất của hôm nay ⇒ tổng tháng tính lại: không còn ngày đi làm.
    expect(r.totals).toMatchObject({ presentDays: 0, lateDays: 0, throughDate: '2026-11-17' });
    expect(r.totals).toEqual((await t.queries.month({ userId: MIA, month: '2026-11' })).totals);
    expect(await t.backend.eventRows()).toHaveLength(1);
    expect(t.audit.map((a) => a.action)).toEqual(['EVENT_VOID']);
    expect(t.notified).toEqual([{ recipientId: MIA, eventId: id, actorId: HANA }]);
    await expect(t.eventUseCases.void(hana, { id, reason: 'lần 2' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'RESOURCE_CONFLICT',
      details: { reason: 'already_voided' },
    });
  });

  it('AT-15 void id không tồn tại ⇒ 404 attendance_event; lượt khác không bị đụng', async () => {
    const t = await createAttendanceHarness();
    await t.punch('IN', key(1));
    await expect(
      t.eventUseCases.void(hana, { id: '0199e5a2-0000-7000-8000-00000000ffff', reason: 'x' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'attendance_event' },
    });
    expect((await t.backend.eventRows())[0]!.voidedAt).toBeNull();
  });

  it('void lượt của chính mình (HR) ⇒ 403', async () => {
    const t = await createAttendanceHarness();
    await t.punch('IN', key(1), HANA);
    await expect(
      t.eventUseCases.void(hana, { id: (await t.backend.eventRows())[0]!.id, reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('AT-16 sau khi hủy IN web, check-in lại cùng ngày ⇒ được (unique chỉ tính lượt chưa hủy)', async () => {
    const t = await createAttendanceHarness();
    await t.punch('IN', key(1));
    await t.eventUseCases.void(hana, {
      id: (await t.backend.eventRows())[0]!.id,
      reason: 'Sai giờ',
    });
    t.at('2026-11-17 08:10');
    await expect(t.punch('IN', key(2))).resolves.toMatchObject({ status: 'PRESENT', late: true });
  });

  it('AT-20 HR xem lượt: người chưa từng có dữ liệu ⇒ 404; có dữ liệu (kể cả đã rời) ⇒ đủ lượt, gồm lượt đã hủy, sắp theo giờ', async () => {
    const t = await createAttendanceHarness();
    await expect(
      t.eventUseCases.listForHr({ userId: MIA, date: '2026-11-17' }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'user' } });
    await t.punch('IN', key(1));
    t.at('2026-11-17 12:00');
    await t.punch('OUT', key(2));
    await t.eventUseCases.void(hana, {
      id: (await t.backend.eventRows())[1]!.id,
      reason: 'Nhầm',
    });
    t.members.delete(MIA); // đã rời
    const r = await t.eventUseCases.listForHr({ userId: MIA, date: '2026-11-17' });
    expect(AttendanceEventsDto.parse(r)).toEqual(r);
    expect(r.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(r.events.map((e) => [e.kind, e.voidReason])).toEqual([
      ['IN', null],
      ['OUT', 'Nhầm'],
    ]);
    expect(r.events[0]).toMatchObject({ ip: '203.0.113.7', userAgent: 'Mozilla/5.0' });
  });

  it('lượt thêm KHÔNG theo thứ tự giờ (OUT trước, IN sau) ⇒ trả theo giờ; me/events không lẫn lượt của Max cùng ngày', async () => {
    const t = await createAttendanceHarness('2026-11-17 20:00');
    await t.eventUseCases.adjust(hana, adjustBody({ kind: 'OUT', time: '17:30' }));
    await t.eventUseCases.adjust(hana, adjustBody({ kind: 'IN', time: '08:00' }));
    await t.eventUseCases.adjust(hana, adjustBody({ userId: MAX, time: '07:00' }));
    for (const r of [
      await t.eventUseCases.listMine({ userId: MIA, date: '2026-11-17' }),
      await t.eventUseCases.listForHr({ userId: MIA, date: '2026-11-17' }),
    ]) {
      expect(r.events.map((e) => [e.userId, e.kind])).toEqual([
        [MIA, 'IN'],
        [MIA, 'OUT'],
      ]);
    }
  });

  it('me/events: nhân viên xem lượt của chính mình kèm IP/UA (NĐ 13 Đ.14); chưa có lượt ⇒ danh sách rỗng, không 404', async () => {
    const t = await createAttendanceHarness();
    expect(await t.eventUseCases.listMine({ userId: MIA, date: '2026-11-17' })).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      events: [],
    });
    await t.punch('IN', key(1));
    const r = await t.eventUseCases.listMine({ userId: MIA, date: '2026-11-17' });
    expect(r.events).toEqual([
      expect.objectContaining({
        userId: MIA,
        ip: '203.0.113.7',
        createdBy: { id: MIA, fullName: 'Mia' },
      }),
    ]);
  });
});
