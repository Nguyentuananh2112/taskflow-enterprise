import { AttendanceEventChangeDto, AttendanceEventsDto } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import {
  createAttendanceHarness,
  HANA,
  key,
  MIA,
  OLIVIA,
  VIC,
  vnTime,
  W1,
  W2,
} from '../../testing/attendance-harness';

// test-spec-hr §5 (tầng A): AT-12..AT-16, AT-20 + route của chính nhân viên (§5, NĐ 13 Đ.14).
const hana = { userId: HANA, isOwner: false };
const olivia = { userId: OLIVIA, isOwner: true };
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
    const t = createAttendanceHarness('2026-11-17 10:00');
    const r = await t.eventUseCases.adjust(W1, hana, adjustBody());
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
    const t = createAttendanceHarness('2026-11-18 10:00');
    const r = await t.eventUseCases.adjust(
      W1,
      hana,
      adjustBody({ kind: 'OUT', date: '2026-11-17', time: '00:30', nextDay: true }),
    );
    expect(r.event).toMatchObject({
      workDate: '2026-11-17',
      occurredAt: vnTime('2026-11-18 00:30').toISOString(),
    });
  });

  it('AT-13 Hana tự điều chỉnh cho chính mình ⇒ 403; Olivia (OWNER) cho chính mình ⇒ được + audit, không tự thông báo', async () => {
    const t = createAttendanceHarness('2026-11-17 10:00');
    await expect(
      t.eventUseCases.adjust(W1, hana, adjustBody({ userId: HANA })),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(t.events.rows).toHaveLength(0);
    const r = await t.eventUseCases.adjust(W1, olivia, adjustBody({ userId: OLIVIA }));
    expect(r.event.createdBy).toEqual({ id: OLIVIA, fullName: 'Olivia' });
    expect(t.audit.map((a) => a.action)).toEqual(['EVENT_ADJUST']);
    expect(t.notified).toEqual([]);
  });

  it('ADJUSTMENT cho VIEWER / người không còn là thành viên ⇒ 404 user (không phải nhân viên)', async () => {
    const t = createAttendanceHarness('2026-11-17 10:00');
    await expect(
      t.eventUseCases.adjust(W1, hana, adjustBody({ userId: VIC })),
    ).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'user' },
    });
    t.members.delete(MIA);
    await expect(t.eventUseCases.adjust(W1, hana, adjustBody())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('AT-14 void có lý do ⇒ 200 { event, day }, voidedAt/By/Reason, dòng KHÔNG bị xóa; void lần 2 ⇒ 409 already_voided', async () => {
    const t = createAttendanceHarness();
    await t.punch('IN', key(1));
    const id = t.events.rows[0]!.id;
    t.at('2026-11-17 10:00');
    const r = await t.eventUseCases.void(W1, hana, { id, reason: 'Bấm hộ' });
    expect(AttendanceEventChangeDto.parse(r)).toEqual(r);
    expect(r.event).toMatchObject({
      id,
      voidedBy: { id: HANA, fullName: 'Hana' },
      voidReason: 'Bấm hộ',
      voidedAt: vnTime('2026-11-17 10:00').toISOString(),
    });
    expect(r.day.firstIn).toBeNull();
    expect(t.events.rows).toHaveLength(1);
    expect(t.audit.map((a) => a.action)).toEqual(['EVENT_VOID']);
    expect(t.notified).toEqual([{ recipientId: MIA, eventId: id, actorId: HANA }]);
    await expect(t.eventUseCases.void(W1, hana, { id, reason: 'lần 2' })).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'already_voided' },
    });
  });

  it('AT-15 void lượt của workspace khác / id không tồn tại ⇒ 404 attendance_event', async () => {
    const t = createAttendanceHarness();
    await t.punch('IN', key(1));
    const id = t.events.rows[0]!.id;
    for (const [ws, eventId] of [
      [W2, id],
      [W1, '0199e5a2-0000-7000-8000-00000000ffff'],
    ] as const) {
      await expect(
        t.eventUseCases.void(ws, hana, { id: eventId, reason: 'x' }),
      ).rejects.toMatchObject({
        statusCode: 404,
        details: { resource: 'attendance_event' },
      });
    }
    expect(t.events.rows[0]!.voidedAt).toBeNull();
  });

  it('void lượt của chính mình (HR không phải OWNER) ⇒ 403', async () => {
    const t = createAttendanceHarness();
    await t.punch('IN', key(1), HANA);
    await expect(
      t.eventUseCases.void(W1, hana, { id: t.events.rows[0]!.id, reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('AT-16 sau khi hủy IN web, check-in lại cùng ngày ⇒ được (unique chỉ tính lượt chưa hủy)', async () => {
    const t = createAttendanceHarness();
    await t.punch('IN', key(1));
    await t.eventUseCases.void(W1, hana, { id: t.events.rows[0]!.id, reason: 'Sai giờ' });
    t.at('2026-11-17 08:10');
    await expect(t.punch('IN', key(2))).resolves.toMatchObject({ status: 'PRESENT', late: true });
  });

  it('AT-20 HR xem lượt: người chưa từng có dữ liệu ⇒ 404; có dữ liệu (kể cả đã rời) ⇒ đủ lượt, gồm lượt đã hủy, sắp theo giờ', async () => {
    const t = createAttendanceHarness();
    await expect(
      t.eventUseCases.listForHr({ workspaceId: W1, userId: MIA, date: '2026-11-17' }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'user' } });
    await t.punch('IN', key(1));
    t.at('2026-11-17 12:00');
    await t.punch('OUT', key(2));
    await t.eventUseCases.void(W1, hana, { id: t.events.rows[1]!.id, reason: 'Nhầm' });
    t.members.delete(MIA); // đã rời
    const r = await t.eventUseCases.listForHr({ workspaceId: W1, userId: MIA, date: '2026-11-17' });
    expect(AttendanceEventsDto.parse(r)).toEqual(r);
    expect(r.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(r.events.map((e) => [e.kind, e.voidReason])).toEqual([
      ['IN', null],
      ['OUT', 'Nhầm'],
    ]);
    expect(r.events[0]).toMatchObject({ ip: '203.0.113.7', userAgent: 'Mozilla/5.0' });
  });

  it('me/events: nhân viên xem lượt của chính mình kèm IP/UA (NĐ 13 Đ.14); chưa có lượt ⇒ danh sách rỗng, không 404', async () => {
    const t = createAttendanceHarness();
    expect(
      await t.eventUseCases.listMine({ workspaceId: W1, userId: MIA, date: '2026-11-17' }),
    ).toEqual({ timezone: 'Asia/Ho_Chi_Minh', events: [] });
    await t.punch('IN', key(1));
    const r = await t.eventUseCases.listMine({ workspaceId: W1, userId: MIA, date: '2026-11-17' });
    expect(r.events).toEqual([
      expect.objectContaining({
        userId: MIA,
        ip: '203.0.113.7',
        createdBy: { id: MIA, fullName: 'Mia' },
      }),
    ]);
  });
});
