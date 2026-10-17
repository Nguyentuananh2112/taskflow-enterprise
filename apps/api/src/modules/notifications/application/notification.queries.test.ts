import { NotificationDto, NotificationType } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { ResourceNotFoundError } from '../../../core/errors';
import { HR_AUDIENCE_TYPES, NOTIFICATION_TYPES } from '../domain/notification';
import { createNotificationHarness, U } from '../testing/notification-harness';

const REQ = '0000aaaa-0000-7000-8000-00000000aaaa';
const OTHER = '0000bbbb-0000-7000-8000-00000000bbbb';

/** Olivia (ADMIN) + Hana (HR) có: 1 LEAVE_SUBMITTED (HR) từ Mia; Mia có LEAVE_APPROVED. */
async function seeded() {
  const h = createNotificationHarness();
  h.context.users.set(U.mia, 'Mia Nguyễn');
  h.context.users.set(U.hana, 'Hana Trần');
  h.context.leaves.set(REQ, {
    type: 'ANNUAL',
    startDate: '2026-11-18',
    endDate: '2026-11-19',
  });
  await h.notifyInTx({
    type: 'LEAVE_SUBMITTED',
    refId: REQ,
    actorId: U.mia,
    recipient: { kind: 'hr' },
  });
  h.clock.advance(1000);
  await h.notifyInTx({
    type: 'LEAVE_APPROVED',
    refId: REQ,
    actorId: U.hana,
    recipient: { kind: 'user', userId: U.mia },
  });
  return h;
}

describe('NotificationQueries — chỉ của mình, chỉ khi còn thuộc công ty, loại HR theo quyền hiện tại', () => {
  it('DTO join actor, loại + khoảng ngày đơn; parse được bằng NotificationDto; KHÔNG có lý do', async () => {
    const h = await seeded();
    const { items, nextAfter } = await h.queries.list(U.hana, { limit: 20 });
    expect(nextAfter).toBeNull();
    expect(items).toHaveLength(1);
    const [dto] = items;
    expect(NotificationDto.strict().parse(dto)).toEqual(dto);
    expect(dto).toMatchObject({
      type: 'LEAVE_SUBMITTED',
      refId: REQ,
      actor: { id: U.mia, fullName: 'Mia Nguyễn' },
      leave: { type: 'ANNUAL', startDate: '2026-11-18', endDate: '2026-11-19' },
      readAt: null,
    });
    expect(JSON.stringify(dto)).not.toMatch(/reason|decisionNote/);
  });

  it('chỉ trả thông báo của người gọi (recipientId = me): Max không thấy gì của Mia / HR', async () => {
    const h = await seeded();
    expect((await h.queries.list(U.max, { limit: 20 })).items).toEqual([]);
    expect(await h.queries.unreadCount(U.max)).toBe(0);
    expect((await h.queries.list(U.mia, { limit: 20 })).items.map((n) => n.type)).toEqual([
      'LEAVE_APPROVED',
    ]);
  });

  it('SEC-HR-18 (Mốc 3.5): nghỉ việc / quá access_until ⇒ danh sách + số chưa đọc rỗng', async () => {
    const h = await seeded();
    h.audience.remove(U.mia);
    expect((await h.queries.list(U.mia, { limit: 20 })).items).toEqual([]);
    expect(await h.queries.unreadCount(U.mia)).toBe(0);
  });

  it('T-040b: nghỉ rồi được nhận lại ⇒ thông báo của tư cách CŨ ẩn ở list / unread / markRead (404); mới thì thấy', async () => {
    const h = await seeded();
    const [old] = (await h.queries.list(U.mia, { limit: 20 })).items;
    h.clock.advance(60_000);
    h.audience.rehire(U.mia, h.clock.now());

    expect((await h.queries.list(U.mia, { limit: 20 })).items).toEqual([]);
    expect(await h.queries.unreadCount(U.mia)).toBe(0);
    await expect(h.queries.markRead(U.mia, old!.id)).rejects.toBeInstanceOf(ResourceNotFoundError);

    // Thông báo tạo ĐÚNG lúc vào lại (cùng mili giây) thuộc nhiệm kỳ mới.
    await h.notifyInTx({
      type: 'LEAVE_REJECTED',
      refId: REQ,
      actorId: U.hana,
      recipient: { kind: 'user', userId: U.mia },
    });
    expect((await h.queries.list(U.mia, { limit: 20 })).items.map((n) => n.type)).toEqual([
      'LEAVE_REJECTED',
    ]);
    await h.queries.markAllRead(U.mia);
    expect(await h.queries.unreadCount(U.mia)).toBe(0);
  });

  it('T-040b: đổi grants KHÔNG mở tư cách mới — HR bị thu rồi cấp lại vẫn thấy thông báo cũ', async () => {
    const h = await seeded();
    h.audience.set(U.hana, false);
    h.audience.set(U.hana, true);
    expect((await h.queries.list(U.hana, { limit: 20 })).items.map((n) => n.type)).toEqual([
      'LEAVE_SUBMITTED',
    ]);
  });

  it('SEC-HR-19: thu grant ⇒ loại dành cho HR biến khỏi chuông NGAY; cấp lại ⇒ hiện lại; loại thường vẫn thấy', async () => {
    const h = await seeded();
    await h.notifyInTx({
      type: 'ATTENDANCE_ADJUSTED',
      refId: REQ,
      actorId: U.olivia,
      recipient: { kind: 'user', userId: U.hana },
    });
    expect(await h.queries.unreadCount(U.hana)).toBe(2);

    h.audience.set(U.hana, false);
    const after = await h.queries.list(U.hana, { limit: 20 });
    expect(after.items.map((n) => n.type)).toEqual(['ATTENDANCE_ADJUSTED']);
    expect(await h.queries.unreadCount(U.hana)).toBe(1);

    h.audience.set(U.hana, true);
    expect(await h.queries.unreadCount(U.hana)).toBe(2);
  });

  it('SEC-HR-17: đánh dấu id của người khác ⇒ 404; của mình ⇒ ok + idempotent; loại HR khi đã mất quyền ⇒ 404', async () => {
    const h = await seeded();
    const [mine] = (await h.queries.list(U.hana, { limit: 20 })).items;
    const id = mine?.id ?? '';

    await expect(h.queries.markRead(U.max, id)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(h.queries.markRead(U.otto, id)).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(await h.queries.unreadCount(U.hana)).toBe(1); // người khác không đổi được trạng thái

    await h.queries.markRead(U.hana, id);
    const readAt = h.store.rows().find((r) => r.id === id)?.readAt;
    expect(readAt).toEqual(h.clock.now());
    h.clock.advance(5000);
    await h.queries.markRead(U.hana, id); // lần 2: vẫn 2xx, giữ readAt cũ
    expect(h.store.rows().find((r) => r.id === id)?.readAt).toEqual(readAt);

    h.audience.set(U.hana, false);
    await expect(h.queries.markRead(U.hana, id)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      h.queries.markRead(U.hana, '00000000-0000-7000-8000-0000000fffff'),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'notification' } });
  });

  it('read-all chỉ đánh dấu thông báo của mình', async () => {
    const h = await seeded();
    await h.queries.markAllRead(U.olivia);
    expect(await h.queries.unreadCount(U.olivia)).toBe(0);
    expect(await h.queries.unreadCount(U.hana)).toBe(1);
    expect(await h.queries.unreadCount(U.mia)).toBe(1);
  });

  it('phân trang keyset (createdAt, id): createdAt mới hơn đứng trước dù id nhỏ hơn', async () => {
    const h = createNotificationHarness();
    const notify = () =>
      h.notifyInTx({
        type: 'ATTENDANCE_ADJUSTED',
        refId: REQ,
        actorId: U.hana,
        recipient: { kind: 'user', userId: U.mia },
      });
    await notify();
    h.clock.advance(-60_000); // id tăng nhưng createdAt lùi (uuid v7 cùng ms không có thứ tự)
    await notify();
    const [older, newer] = h.store.rows().sort((a, b) => (a.id < b.id ? -1 : 1));
    const p1 = await h.queries.list(U.mia, { limit: 1 });
    expect(p1.items.map((n) => n.id)).toEqual([older?.id]);
    const p2 = await h.queries.list(U.mia, { after: p1.nextAfter ?? undefined, limit: 1 });
    expect(p2.items.map((n) => n.id)).toEqual([newer?.id]);
    expect(p2.nextAfter).toBeNull();
  });

  it('phân trang keyset: mới nhất trước, nextAfter = id cuối trang, trang sau không lặp', async () => {
    const h = createNotificationHarness();
    for (let i = 0; i < 5; i += 1) {
      await h.notifyInTx({
        type: 'ATTENDANCE_ADJUSTED',
        refId: REQ,
        actorId: U.hana,
        recipient: { kind: 'user', userId: U.mia },
      });
    }
    const all = h.store
      .rows()
      .map((r) => r.id)
      .sort()
      .reverse();
    const p1 = await h.queries.list(U.mia, { limit: 2 });
    expect(p1.items.map((n) => n.id)).toEqual(all.slice(0, 2));
    expect(p1.nextAfter).toEqual({ createdAt: h.clock.now(), id: all[1] }); // cùng createdAt ⇒ id phân định
    const p2 = await h.queries.list(U.mia, { after: p1.nextAfter ?? undefined, limit: 2 });
    expect(p2.items.map((n) => n.id)).toEqual(all.slice(2, 4));
    const p3 = await h.queries.list(U.mia, { after: p2.nextAfter ?? undefined, limit: 2 });
    expect(p3.items.map((n) => n.id)).toEqual(all.slice(4));
    expect(p3.nextAfter).toBeNull();
  });

  it('ngữ cảnh đơn tra theo id: id khác không bị join; actor không tồn tại ⇒ null', async () => {
    const h = createNotificationHarness();
    h.context.leaves.set(OTHER, {
      type: 'SICK',
      startDate: '2026-11-18',
      endDate: '2026-11-18',
    });
    await h.notifyInTx({
      type: 'LEAVE_REJECTED',
      refId: REQ,
      actorId: U.hana,
      recipient: { kind: 'user', userId: U.mia },
    });
    const [dto] = (await h.queries.list(U.mia, { limit: 20 })).items;
    expect(dto?.leave).toBeNull();
    expect(dto?.actor).toBeNull();
  });

  it('loại không phải đơn nghỉ ⇒ leave null dù refId trùng id một đơn', async () => {
    const h = createNotificationHarness();
    h.context.leaves.set(REQ, {
      type: 'ANNUAL',
      startDate: '2026-11-18',
      endDate: '2026-11-18',
    });
    await h.notifyInTx({
      type: 'ATTENDANCE_ADJUSTED',
      refId: REQ,
      actorId: U.hana,
      recipient: { kind: 'user', userId: U.mia },
    });
    expect((await h.queries.list(U.mia, { limit: 20 })).items[0]?.leave).toBeNull();
  });
});

describe('parity domain ↔ contracts (ADR-080)', () => {
  it('NOTIFICATION_TYPES = NotificationType của contracts; loại HR là tập con', () => {
    expect([...NOTIFICATION_TYPES].sort()).toEqual([...NotificationType.options].sort());
    for (const t of HR_AUDIENCE_TYPES) expect(NOTIFICATION_TYPES).toContain(t);
  });
});
