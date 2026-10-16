import { NotificationNewEvent } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { createNotificationHarness, U, W1, W2 } from '../testing/notification-harness';
import { NotifyOutsideTransactionError } from './notification-publisher';

const REQ = '0000aaaa-0000-7000-8000-00000000aaaa';

describe('NotificationPublisher.notify (ADR-123, T-040)', () => {
  it('recipient user ⇒ đúng 1 dòng cho người đó, event `notification:new` CHỈ sau commit', async () => {
    const h = createNotificationHarness();
    let sentDuringTx = -1;
    await h.uow.run(async () => {
      await h.publisher.notify({
        workspaceId: W1,
        type: 'LEAVE_APPROVED',
        refId: REQ,
        actorId: U.hana,
        recipient: { kind: 'user', userId: U.mia },
      });
      sentDuringTx = h.realtime.sent.length;
    });

    expect(sentDuringTx).toBe(0); // không phát trong transaction
    const rows = h.store.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId: W1,
      recipientId: U.mia,
      type: 'LEAVE_APPROVED',
      refId: REQ,
      actorId: U.hana,
      readAt: null,
      createdAt: h.clock.now(),
    });
    expect(h.realtime.sent).toEqual([
      {
        input: {
          recipientId: U.mia,
          notificationId: rows[0]?.id,
          type: 'LEAVE_APPROVED',
          workspaceId: W1,
        },
        meta: { actorId: U.hana, originClientId: null },
      },
    ]);
  });

  it('recipient hr ⇒ mọi người có hr:manage HIỆN TẠI (OWNER + grant HR_MANAGE), không PM/MEMBER/VIEWER, ws khác không dính', async () => {
    const h = createNotificationHarness();
    await h.notifyInTx({
      workspaceId: W1,
      type: 'LEAVE_SUBMITTED',
      refId: REQ,
      actorId: U.mia,
      recipient: { kind: 'hr' },
    });
    expect(
      h.store
        .rows()
        .map((r) => r.recipientId)
        .sort(),
    ).toEqual([U.olivia, U.hana].sort());
    expect(h.realtime.sent.map((e) => e.input.recipientId).sort()).toEqual(
      [U.olivia, U.hana].sort(),
    );
  });

  it('fan-out HR đọc quyền tại thời điểm ghi: thu grant của Hana trước ⇒ Hana không nhận; cấp cho Max ⇒ Max nhận', async () => {
    const h = createNotificationHarness();
    h.audience.set(W1, U.hana, 'MEMBER', []);
    h.audience.set(W1, U.max, 'MEMBER', ['HR_MANAGE']);
    await h.notifyInTx({
      workspaceId: W1,
      type: 'LEAVE_CANCELLED',
      refId: REQ,
      actorId: U.mia,
      recipient: { kind: 'hr' },
    });
    expect(
      h.store
        .rows()
        .map((r) => r.recipientId)
        .sort(),
    ).toEqual([U.olivia, U.max].sort());
  });

  it('người gây ra không tự nhận: HR gửi đơn của chính mình ⇒ chỉ HR khác; OWNER tự duyệt ⇒ không dòng nào', async () => {
    const h = createNotificationHarness();
    await h.notifyInTx({
      workspaceId: W1,
      type: 'LEAVE_SUBMITTED',
      refId: REQ,
      actorId: U.hana,
      recipient: { kind: 'hr' },
    });
    expect(h.store.rows().map((r) => r.recipientId)).toEqual([U.olivia]);

    const h2 = createNotificationHarness();
    await h2.notifyInTx({
      workspaceId: W1,
      type: 'LEAVE_APPROVED',
      refId: REQ,
      actorId: U.olivia,
      recipient: { kind: 'user', userId: U.olivia },
    });
    expect(h2.store.rows()).toEqual([]);
    expect(h2.realtime.sent).toEqual([]);
  });

  it('L1: phát cho một người nhận lỗi ⇒ người nhận khác vẫn nhận event (mỗi bản ghi một hook)', async () => {
    const h = createNotificationHarness();
    const original = h.realtime.notifyNotification.bind(h.realtime);
    h.realtime.notifyNotification = (input, meta) =>
      input.recipientId === U.olivia
        ? Promise.reject(new Error('socket lỗi'))
        : original(input, meta);
    await h.notifyInTx({
      workspaceId: W1,
      type: 'LEAVE_SUBMITTED',
      refId: REQ,
      actorId: U.mia,
      recipient: { kind: 'hr' },
    });
    expect(h.uow.hookErrors).toHaveLength(1);
    expect(h.realtime.sent.map((e) => e.input.recipientId)).toEqual([U.hana]);
    expect(h.store.rows()).toHaveLength(2); // dòng bền vẫn còn (client tải lại khi kết nối lại)
  });

  it('ws chỉ có actor là HR ⇒ không ghi, không phát', async () => {
    const h = createNotificationHarness();
    await h.notifyInTx({
      workspaceId: W2,
      type: 'LEAVE_SUBMITTED',
      refId: REQ,
      actorId: U.otto,
      recipient: { kind: 'hr' },
    });
    expect(h.store.rows()).toEqual([]);
    expect(h.realtime.sent).toEqual([]);
  });

  it('thay đổi nghiệp vụ rollback ⇒ không còn dòng thông báo, không event (ghi CÙNG transaction)', async () => {
    const h = createNotificationHarness();
    await expect(
      h.uow.run(async () => {
        await h.publisher.notify({
          workspaceId: W1,
          type: 'ATTENDANCE_ADJUSTED',
          refId: REQ,
          actorId: U.hana,
          recipient: { kind: 'user', userId: U.mia },
        });
        throw new Error('nghiệp vụ lỗi sau khi ghi thông báo');
      }),
    ).rejects.toThrow('nghiệp vụ lỗi');
    expect(h.uow.rollbacks).toBe(1);
    expect(h.store.rows()).toEqual([]);
    expect(h.realtime.sent).toEqual([]);
  });

  it('gọi ngoài uow.run ⇒ ném NotifyOutsideTransactionError (không ghi lẻ ngoài transaction)', async () => {
    const h = createNotificationHarness();
    await expect(
      h.publisher.notify({
        workspaceId: W1,
        type: 'LEAVE_APPROVED',
        refId: REQ,
        actorId: U.hana,
        recipient: { kind: 'user', userId: U.mia },
      }),
    ).rejects.toBeInstanceOf(NotifyOutsideTransactionError);
    expect(h.store.rows()).toEqual([]);
  });

  it('SEC-HR-20: payload event khớp `NotificationNewEvent` của contracts — chỉ id + loại + ws, không lý do / ghi chú', async () => {
    const h = createNotificationHarness();
    await h.notifyInTx({
      workspaceId: W1,
      type: 'LEAVE_REVOKED',
      refId: REQ,
      actorId: U.hana,
      recipient: { kind: 'user', userId: U.mia },
    });
    const [sent] = h.realtime.sent;
    expect(Object.keys(sent?.input ?? {}).sort()).toEqual(
      ['notificationId', 'recipientId', 'type', 'workspaceId'].sort(),
    );
    // gateway bỏ recipientId (dùng làm phòng `user:{id}`) và bọc vỏ chung — data phải parse strict.
    const { recipientId: _room, ...data } = sent?.input ?? { recipientId: '' };
    expect(NotificationNewEvent.shape.data.strict().safeParse(data).success).toBe(true);
  });
});
