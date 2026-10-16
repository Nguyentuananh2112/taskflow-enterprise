// T-040 tầng I (ADR-123, attendance-leave.md §9 B-M3 / B-H3b / B-H2): store + audience + context Prisma
// trên Postgres thật — ghi trong transaction của bên gọi (rollback ⇒ 0 dòng), WHERE luôn có recipient_id,
// loại dành cho HR lọc theo quyền hiện tại đọc từ workspace_members, ngữ cảnh đơn không bao giờ chứa lý do.
import { hasPermission } from '@taskflow/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { UuidV7Generator } from '../../../src/core/infrastructure/system';
import {
  NotifyOutsideTransactionError,
  NotificationPublisher,
} from '../../../src/modules/notifications/application/notification-publisher';
import { NotificationQueries } from '../../../src/modules/notifications/application/notification.queries';
import {
  PrismaNotificationAudience,
  PrismaNotificationContextReader,
} from '../../../src/modules/notifications/infrastructure/prisma/prisma-notification-readers';
import { PrismaNotificationStore } from '../../../src/modules/notifications/infrastructure/prisma/prisma-notification.store';
import { SpyRealtime } from '../../../src/modules/notifications/testing/notification-harness';
import { FakeClock } from '../../support';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const REASON = 'Sốt cao — lý do sức khỏe nhạy cảm';

let uow: RecordingUnitOfWork;
let clock: FakeClock;
let realtime: SpyRealtime;
let publisher: NotificationPublisher;
let queries: NotificationQueries;
let ids: Record<
  'olivia' | 'hana' | 'mia' | 'max' | 'otto' | 'w1' | 'w2' | 'leave' | 'leaveW2',
  string
>;

async function seed() {
  const prisma = testPrisma();
  const user = (name: string) =>
    prisma.user.create({
      data: { email: `${name}@example.test`, fullName: name, passwordHash: 'x' },
    });
  const [olivia, hana, mia, max, otto] = await Promise.all(
    ['Olivia', 'Hana', 'Mia', 'Max', 'Otto'].map(user),
  );
  const w1 = await prisma.workspace.create({ data: { name: 'Công ty Một', slug: 'w-one' } });
  const w2 = await prisma.workspace.create({ data: { name: 'Công ty Hai', slug: 'w-two' } });
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: w1.id, userId: olivia!.id, role: 'OWNER' },
      { workspaceId: w1.id, userId: hana!.id, role: 'MEMBER', grants: ['HR_MANAGE'] },
      { workspaceId: w1.id, userId: mia!.id, role: 'MEMBER' },
      { workspaceId: w1.id, userId: max!.id, role: 'MEMBER' },
      { workspaceId: w2.id, userId: otto!.id, role: 'OWNER' },
    ],
  });
  const leave = await prisma.leaveRequest.create({
    data: {
      workspaceId: w1.id,
      userId: mia!.id,
      type: 'SICK',
      startDate: new Date('2026-11-18'),
      endDate: new Date('2026-11-19'),
      reason: REASON,
    },
  });
  const leaveW2 = await prisma.leaveRequest.create({
    data: {
      workspaceId: w2.id,
      userId: otto!.id,
      type: 'ANNUAL',
      startDate: new Date('2026-12-01'),
      endDate: new Date('2026-12-01'),
      reason: REASON,
    },
  });
  return {
    olivia: olivia!.id,
    hana: hana!.id,
    mia: mia!.id,
    max: max!.id,
    otto: otto!.id,
    w1: w1.id,
    w2: w2.id,
    leave: leave.id,
    leaveW2: leaveW2.id,
  };
}

beforeEach(async () => {
  await resetDatabase();
  ids = await seed();
  uow = new RecordingUnitOfWork();
  clock = new FakeClock('2026-11-17T03:00:00.000Z');
  realtime = new SpyRealtime();
  const db = () => uow.db();
  const store = new PrismaNotificationStore(db);
  const audience = new PrismaNotificationAudience(db);
  const canManageHr = (role: Parameters<typeof hasPermission>[0], grants: readonly 'HR_MANAGE'[]) =>
    hasPermission(role, grants, 'hr:manage');
  publisher = new NotificationPublisher({
    store,
    audience,
    canManageHr,
    realtime,
    uow,
    ids: new UuidV7Generator(),
    clock,
  });
  queries = new NotificationQueries({
    store,
    audience,
    context: new PrismaNotificationContextReader(db),
    canManageHr,
    clock,
  });
});
afterAll(disconnectTestPrisma);

const miaSubmits = (refId = ids.leave) =>
  uow.run(() =>
    publisher.notify({
      workspaceId: ids.w1,
      type: 'LEAVE_SUBMITTED',
      refId,
      actorId: ids.mia,
      recipient: { kind: 'hr' },
    }),
  );
const rows = () =>
  testPrisma().notification.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

describe('ghi (ADR-123)', () => {
  it('fan-out HR trong transaction: dòng cho OWNER + HR grant, không cho người gửi / MEMBER / ws khác; event sau commit', async () => {
    await miaSubmits();
    const stored = await rows();
    expect(stored.map((r) => r.recipientId).sort()).toEqual([ids.olivia, ids.hana].sort());
    expect(stored.every((r) => r.createdAt.getTime() === clock.now().getTime())).toBe(true);
    expect(realtime.sent.map((e) => e.input.notificationId).sort()).toEqual(
      stored.map((r) => r.id).sort(),
    );
  });

  it('nghiệp vụ ném sau khi ghi thông báo ⇒ rollback thật: 0 dòng, 0 event', async () => {
    await expect(
      uow.run(async () => {
        await publisher.notify({
          workspaceId: ids.w1,
          type: 'LEAVE_SUBMITTED',
          refId: ids.leave,
          actorId: ids.mia,
          recipient: { kind: 'hr' },
        });
        throw new Error('lỗi nghiệp vụ');
      }),
    ).rejects.toThrow('lỗi nghiệp vụ');
    expect(await rows()).toEqual([]);
    expect(realtime.sent).toEqual([]);
  });

  it('ngoài transaction ⇒ NotifyOutsideTransactionError, không ghi', async () => {
    await expect(
      publisher.notify({
        workspaceId: ids.w1,
        type: 'LEAVE_APPROVED',
        refId: ids.leave,
        actorId: ids.hana,
        recipient: { kind: 'user', userId: ids.mia },
      }),
    ).rejects.toBeInstanceOf(NotifyOutsideTransactionError);
    expect(await rows()).toEqual([]);
  });

  it('xóa cứng workspace (purge) ⇒ thông báo cascade theo (FK workspace_id ON DELETE CASCADE)', async () => {
    await miaSubmits();
    await testPrisma().workspace.delete({ where: { id: ids.w1 } });
    expect(await rows()).toEqual([]);
  });
});

describe('đọc — recipient_id = me, ws còn là thành viên, loại HR theo quyền hiện tại', () => {
  it('DTO join tên ws, actor, loại + khoảng ngày đơn; KHÔNG có lý do ở bất kỳ đâu (B-H2)', async () => {
    await miaSubmits();
    const { items } = await queries.list(ids.hana, { limit: 20 });
    expect(items).toEqual([
      expect.objectContaining({
        type: 'LEAVE_SUBMITTED',
        refId: ids.leave,
        workspaceId: ids.w1,
        workspaceName: 'Công ty Một',
        actor: { id: ids.mia, fullName: 'Mia' },
        leave: { type: 'SICK', startDate: '2026-11-18', endDate: '2026-11-19' },
        readAt: null,
      }),
    ]);
    expect(JSON.stringify(items)).not.toContain(REASON);
  });

  it('refId trỏ đơn của ws khác ⇒ không join (tra theo cặp ws + id)', async () => {
    await miaSubmits(ids.leaveW2);
    expect((await queries.list(ids.olivia, { limit: 20 })).items[0]?.leave).toBeNull();
  });

  it('SEC-HR-19: thu grant (UPDATE workspace_members) ⇒ request kế tiếp ẩn loại HR + không đánh dấu được', async () => {
    await miaSubmits();
    const [n] = (await queries.list(ids.hana, { limit: 20 })).items;
    await testPrisma().workspaceMember.updateMany({
      where: { userId: ids.hana },
      data: { grants: [] },
    });
    expect((await queries.list(ids.hana, { limit: 20 })).items).toEqual([]);
    expect(await queries.unreadCount(ids.hana)).toBe(0);
    await expect(queries.markRead(ids.hana, n?.id ?? '')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('SEC-HR-18 + ws xóa mềm: rời ws / ws deleted_at ⇒ ẩn hết', async () => {
    await miaSubmits();
    await testPrisma().workspaceMember.deleteMany({ where: { userId: ids.hana } });
    expect(await queries.unreadCount(ids.hana)).toBe(0);
    await testPrisma().workspace.update({
      where: { id: ids.w1 },
      data: { deletedAt: clock.now(), purgeAt: clock.now() },
    });
    expect(await queries.unreadCount(ids.olivia)).toBe(0);
  });

  it('SEC-HR-17: đánh dấu id của người khác ⇒ 404 và dòng không đổi; của mình ⇒ readAt, lặp lại giữ readAt cũ', async () => {
    await miaSubmits();
    const [n] = (await queries.list(ids.hana, { limit: 20 })).items;
    const id = n?.id ?? '';
    for (const other of [ids.max, ids.mia, ids.otto, ids.olivia]) {
      await expect(queries.markRead(other, id)).rejects.toMatchObject({ statusCode: 404 });
    }
    expect((await testPrisma().notification.findUnique({ where: { id } }))?.readAt).toBeNull();

    await queries.markRead(ids.hana, id);
    const first = (await testPrisma().notification.findUnique({ where: { id } }))?.readAt;
    expect(first).toEqual(clock.now());
    clock.advance(60_000);
    await queries.markRead(ids.hana, id);
    expect((await testPrisma().notification.findUnique({ where: { id } }))?.readAt).toEqual(first);
  });

  it('read-all chỉ dòng của người gọi', async () => {
    await miaSubmits();
    await queries.markAllRead(ids.olivia);
    expect(await queries.unreadCount(ids.olivia)).toBe(0);
    expect(await queries.unreadCount(ids.hana)).toBe(1);
  });

  it('keyset (createdAt, id): nhiều dòng cùng createdAt (fan-out) và createdAt khác ⇒ đủ, không trùng, mới nhất trước', async () => {
    for (let i = 0; i < 5; i += 1) {
      await miaSubmits();
      if (i % 2 === 0) clock.advance(1000); // vài lượt cùng createdAt, vài lượt khác
    }
    const seen: string[] = [];
    let after: Parameters<NotificationQueries['list']>[1]['after'];
    do {
      const page = await queries.list(ids.hana, { after, limit: 2 });
      seen.push(...page.items.map((n) => n.id));
      after = page.nextAfter ?? undefined;
    } while (after);
    const expected = (
      await testPrisma().notification.findMany({
        where: { recipientId: ids.hana },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    ).map((r) => r.id);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(5);
  });
});
