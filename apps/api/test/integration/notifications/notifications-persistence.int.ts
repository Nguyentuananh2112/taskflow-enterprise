// T-040 tầng I (ADR-123; Mốc 3.5 ADR-136): store + audience + context Prisma trên Postgres thật — ghi trong
// transaction của bên gọi (rollback ⇒ 0 dòng), WHERE luôn có recipient_id, loại dành cho HR lọc theo quyền
// công ty HIỆN TẠI đọc từ company_members (audience của module company), ngữ cảnh không bao giờ chứa lý do.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { UuidV7Generator } from '../../../src/core/infrastructure/system';
import { notificationContextFrom } from '../../../src/composition/notification-adapters';
import { PrismaUserRefReader } from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-user-ref.reader';
import { createCompanyModule } from '../../../src/modules/company/company.module';
import {
  PrismaCompany,
  PrismaCompanyMembers,
  PrismaCompanyTenureReader,
} from '../../../src/modules/company/infrastructure/prisma/prisma-company';
import { PrismaCompanyOffboarding } from '../../../src/modules/company/infrastructure/prisma/prisma-company-offboarding';
import { PrismaHrAuditLog } from '../../../src/modules/company/infrastructure/prisma/prisma-hr-audit-log';
import { PrismaLeaveReadModel } from '../../../src/modules/leave/infrastructure/persistence/prisma/prisma-leave-read-model';
import {
  NotifyOutsideTransactionError,
  NotificationPublisher,
} from '../../../src/modules/notifications/application/notification-publisher';
import { NotificationQueries } from '../../../src/modules/notifications/application/notification.queries';
import { PrismaNotificationStore } from '../../../src/modules/notifications/infrastructure/prisma/prisma-notification.store';
import { SpyRealtime } from '../../../src/modules/notifications/testing/notification-harness';
import { FakeClock, SpyLogger } from '../../support';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

let uow: RecordingUnitOfWork;
let clock: FakeClock;
let realtime: SpyRealtime;
let publisher: NotificationPublisher;
let queries: NotificationQueries;
let ids: Record<'olivia' | 'hana' | 'mia' | 'max' | 'otto' | 'leave', string>;

const START = new Date('2026-10-01T00:00:00.000Z');
const REASON = 'Sốt cao — lý do sức khỏe nhạy cảm';

async function seed() {
  const prisma = testPrisma();
  const user = (name: string) =>
    prisma.user.create({
      data: { email: `${name.toLowerCase()}@example.test`, fullName: name, passwordHash: 'x' },
    });
  const [olivia, hana, mia, max, otto] = await Promise.all(
    ['Olivia', 'Hana', 'Mia', 'Max', 'Otto'].map(user),
  );
  const since = new Date(0);
  const employee = (userId: string, grants: 'HR_MANAGE'[] = []) => ({
    userId,
    role: 'EMPLOYEE' as const,
    grants,
    startDate: START,
    createdAt: since,
  });
  await prisma.companyMember.createMany({
    data: [
      { userId: olivia!.id, role: 'ADMIN', createdAt: since },
      employee(hana!.id, ['HR_MANAGE']),
      employee(mia!.id),
      employee(max!.id),
      employee(otto!.id),
    ],
  });
  const leave = await prisma.leaveRequest.create({
    data: {
      userId: mia!.id,
      type: 'SICK',
      startDate: new Date('2026-11-18'),
      endDate: new Date('2026-11-19'),
      reason: REASON,
    },
  });
  return {
    olivia: olivia!.id,
    hana: hana!.id,
    mia: mia!.id,
    max: max!.id,
    otto: otto!.id,
    leave: leave.id,
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
  const company = createCompanyModule({
    repos: {
      company: new PrismaCompany(db),
      members: new PrismaCompanyMembers(db),
      tenures: new PrismaCompanyTenureReader(db),
      hrAudit: new PrismaHrAuditLog(db),
      offboarding: new PrismaCompanyOffboarding(db),
    },
    ids: new UuidV7Generator(),
    clock,
    uow,
    logger: new SpyLogger(),
    responder: {} as never,
    limit: () => [],
    accounts: { current: null },
    collaborators: () => {
      throw new Error('không dùng ở ca này');
    },
    // Không dùng ở ca này (chỉ audience): route admin / dọn đơn không chạy.
    offboardLeave: { offboardCleanup: () => Promise.resolve({ cancelled: 0, revoked: 0 }) },
    accessEvents: {
      accessChanged: () => Promise.resolve(),
      pushAccessChanged: () => Promise.resolve(),
    },
    adminWorkspaces: () => {
      throw new Error('không dùng ở ca này');
    },
  });
  const audience = company.notificationAudience;
  publisher = new NotificationPublisher({
    store,
    audience,
    realtime,
    uow,
    ids: new UuidV7Generator(),
    clock,
  });
  queries = new NotificationQueries({
    store,
    audience,
    context: notificationContextFrom({
      users: new PrismaUserRefReader(db),
      leaves: new PrismaLeaveReadModel(db), // = `leave.readModel` nối ở persistence.ts (production)
    }),
    clock,
  });
});
afterAll(disconnectTestPrisma);

const miaSubmits = (refId = ids.leave) =>
  uow.run(() =>
    publisher.notify({
      type: 'LEAVE_SUBMITTED',
      refId,
      actorId: ids.mia,
      recipient: { kind: 'hr' },
    }),
  );
const rows = () =>
  testPrisma().notification.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

describe('ghi (ADR-123)', () => {
  it('fan-out HR trong transaction: dòng cho Admin + nhân viên có grant HR, không cho người gửi / nhân viên thường; event sau commit', async () => {
    await miaSubmits();
    const stored = await rows();
    expect(stored.map((r) => r.recipientId).sort()).toEqual([ids.olivia, ids.hana].sort());
    expect(stored.every((r) => r.createdAt.getTime() === clock.now().getTime())).toBe(true);
    expect(realtime.sent.map((e) => e.input.notificationId).sort()).toEqual(
      stored.map((r) => r.id).sort(),
    );
  });

  it('fan-out bỏ người đã quá access_until (job hoàn tất chưa chạy)', async () => {
    await testPrisma().companyMember.update({
      where: { userId: ids.hana },
      data: {
        offboardLastDay: new Date('2026-11-15T00:00:00.000Z'),
        offboardAccessUntil: new Date(clock.now().getTime() - 1),
        offboardScheduledById: ids.olivia,
      },
    });
    await miaSubmits();
    expect((await rows()).map((r) => r.recipientId)).toEqual([ids.olivia]);
  });

  it('nghiệp vụ ném sau khi ghi thông báo ⇒ rollback thật: 0 dòng, 0 event', async () => {
    await expect(
      uow.run(async () => {
        await publisher.notify({
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
        type: 'LEAVE_APPROVED',
        refId: ids.leave,
        actorId: ids.hana,
        recipient: { kind: 'user', userId: ids.mia },
      }),
    ).rejects.toBeInstanceOf(NotifyOutsideTransactionError);
    expect(await rows()).toEqual([]);
  });

  it('Mốc 3.5: purge workspace KHÔNG đụng thông báo (không còn workspace_id)', async () => {
    await miaSubmits();
    const ws = await testPrisma().workspace.create({ data: { name: 'W', slug: 'w-purge' } });
    await testPrisma().workspace.delete({ where: { id: ws.id } });
    expect(await rows()).toHaveLength(2);
  });
});

describe('đọc — recipient_id = me, còn thuộc công ty, loại HR theo quyền hiện tại', () => {
  it('DTO join actor + loại / khoảng ngày đơn; KHÔNG có lý do ở bất kỳ đâu (B-H2); không còn trường workspace', async () => {
    await miaSubmits();
    const { items } = await queries.list(ids.hana, { limit: 20 });
    expect(items).toEqual([
      expect.objectContaining({
        type: 'LEAVE_SUBMITTED',
        refId: ids.leave,
        actor: { id: ids.mia, fullName: 'Mia' },
        leave: { type: 'SICK', startDate: '2026-11-18', endDate: '2026-11-19' },
        readAt: null,
      }),
    ]);
    expect(items[0]).not.toHaveProperty('workspaceId');
    expect(JSON.stringify(items)).not.toContain(REASON);
  });

  it('SEC-HR-19: thu grant (UPDATE company_members) ⇒ request kế tiếp ẩn loại HR + không đánh dấu được', async () => {
    await miaSubmits();
    const [n] = (await queries.list(ids.hana, { limit: 20 })).items;
    await testPrisma().companyMember.updateMany({
      where: { userId: ids.hana },
      data: { grants: [] },
    });
    expect((await queries.list(ids.hana, { limit: 20 })).items).toEqual([]);
    expect(await queries.unreadCount(ids.hana)).toBe(0);
    await expect(queries.markRead(ids.hana, n?.id ?? '')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('SEC-HR-18 (Mốc 3.5): quá access_until (job chưa chạy) / đã rời công ty ⇒ ẩn hết', async () => {
    await miaSubmits();
    await testPrisma().companyMember.update({
      where: { userId: ids.hana },
      data: {
        offboardLastDay: new Date('2026-11-15T00:00:00.000Z'),
        offboardAccessUntil: new Date(clock.now().getTime() - 1),
        offboardScheduledById: ids.olivia,
      },
    });
    expect(await queries.unreadCount(ids.hana)).toBe(0);
    await testPrisma().companyMember.delete({ where: { userId: ids.olivia } });
    expect(await queries.unreadCount(ids.olivia)).toBe(0);
  });

  it('T-040b: nghỉ rồi nhận lại (created_at mới) ⇒ thông báo tư cách cũ ẩn ở list / unread / markRead / read-all', async () => {
    await miaSubmits();
    const [old] = (await queries.list(ids.hana, { limit: 20 })).items;
    clock.advance(60_000);
    await testPrisma().companyMember.delete({ where: { userId: ids.hana } });
    await testPrisma().companyMember.create({
      data: {
        userId: ids.hana,
        role: 'EMPLOYEE',
        grants: ['HR_MANAGE'],
        startDate: new Date('2026-11-17T00:00:00.000Z'),
        createdAt: clock.now(),
      },
    });
    expect((await queries.list(ids.hana, { limit: 20 })).items).toEqual([]);
    expect(await queries.unreadCount(ids.hana)).toBe(0);
    await expect(queries.markRead(ids.hana, old?.id ?? '')).rejects.toMatchObject({
      statusCode: 404,
    });
    await queries.markAllRead(ids.hana);
    expect((await rows()).find((r) => r.id === old?.id)?.readAt).toBeNull(); // read-all không chạm dòng cũ

    await miaSubmits(); // cùng mili giây với created_at ⇒ thuộc tư cách mới
    expect(await queries.unreadCount(ids.hana)).toBe(1);
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
