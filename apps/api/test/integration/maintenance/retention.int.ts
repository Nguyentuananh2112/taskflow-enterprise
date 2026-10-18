// T-043 tầng I (R27, data-retention.md §4): job retention trên Postgres thật — đúng ngưỡng ở biên ±1 ngày
// cho từng bước, đơn PENDING giữ lý do, xóa đơn / số dư theo CẢ năm, theo lô + idempotent, một instance
// một lúc (khóa advisory của lô), `signal` hủy ⇒ dừng trước lô kế.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  RetentionJob,
  retentionJob,
  type RetentionPolicy,
} from '../../../src/composition/retention-job';
import {
  RETENTION_LOCK_KEY,
  prismaRetentionStores,
} from '../../../src/composition/retention-stores';
import { FakeClock, SpyLogger } from '../../support';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const NOW = new Date('2026-12-01T00:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const B: RetentionPolicy = {
  clientInfoDays: 395,
  leaveReasonDays: 395,
  recordsDays: 730,
  notificationsDays: 180,
  hrAuditDays: 1826,
};

let user: string;

beforeEach(async () => {
  await resetDatabase();
  const prisma = testPrisma();
  user = (
    await prisma.user.create({
      data: {
        email: `u-${randomUUID().slice(0, 8)}@example.test`,
        fullName: 'U',
        passwordHash: 'x',
      },
    })
  ).id;
});
afterAll(disconnectTestPrisma);

function instance(policy: RetentionPolicy = B) {
  const uow = new RecordingUnitOfWork();
  const stores = prismaRetentionStores(() => uow.db());
  return { uow, stores, job: new RetentionJob({ stores, policy, uow, clock: new FakeClock(NOW) }) };
}

const event = (occurredAt: Date, workDate = occurredAt, kind: 'IN' | 'OUT' = 'OUT') =>
  testPrisma().attendanceEvent.create({
    data: {
      userId: user,
      kind,
      source: 'WEB',
      occurredAt,
      workDate,
      ip: '203.0.113.7',
      userAgent: 'UA',
      createdById: user,
    },
  });
const leave = (
  start: string,
  end: string,
  status: 'PENDING' | 'APPROVED' | 'REJECTED',
  reason: string | null = 'sốt cao',
  decisionNote: string | null = null,
) =>
  testPrisma().leaveRequest.create({
    data: {
      userId: user,
      type: 'SICK',
      startDate: new Date(start),
      endDate: new Date(end),
      status,
      reason,
      decisionNote,
      ...(status === 'PENDING' ? {} : { decidedById: user, decidedAt: new Date(start) }),
    },
  });

describe('job retention (T-043, phương án B)', () => {
  it('D1 / D2: IP+UA NULL khi quá 395 ngày, lượt chấm xóa khi quá 730 ngày — biên ±1 ngày', async () => {
    const scrub = await event(ago(396));
    const keepInfo = await event(ago(394));
    const del = await event(ago(731));
    const keep = await event(ago(729));
    await instance().job.execute();
    const rows = await testPrisma().attendanceEvent.findMany();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.has(del.id)).toBe(false);
    expect(byId.get(keep.id)).toMatchObject({ ip: null, userAgent: null }); // 729 > 395 ⇒ đã scrub
    expect(byId.get(scrub.id)).toMatchObject({ ip: null, userAgent: null });
    expect(byId.get(keepInfo.id)?.userAgent).toBe('UA');
    expect(byId.get(keepInfo.id)?.ip).not.toBeNull();
  });

  it('D2 theo NGÀY CÔNG: OUT sau nửa đêm của ngày công 2024-11-30 bị xóa cùng IN (mốc 2024-12-01)', async () => {
    const day = new Date('2024-11-30T00:00:00.000Z');
    await event(new Date('2024-11-30T01:00:00.000Z'), day, 'IN');
    await event(new Date('2024-12-01T00:30:00.000Z'), day, 'OUT'); // occurred_at SAU mốc, ngày công TRƯỚC
    const kept = await event(new Date('2024-12-01T01:00:00.000Z'), new Date('2024-12-01'), 'IN');
    await instance().job.execute();
    expect((await testPrisma().attendanceEvent.findMany()).map((r) => r.id)).toEqual([kept.id]);
  });

  it('D3: lý do NULL khi end_date quá 395 ngày (đơn đã quyết); đơn PENDING giữ lý do; CHECK not-blank vẫn thỏa', async () => {
    // mốc lý do = NOW − 395 ngày = 2025-11-01
    const scrubbed = await leave('2025-10-31', '2025-10-31', 'APPROVED');
    const kept = await leave('2025-11-01', '2025-11-01', 'APPROVED');
    const pending = await leave('2025-01-10', '2025-01-10', 'PENDING');
    await instance().job.execute();
    const reasons = new Map(
      (await testPrisma().leaveRequest.findMany()).map((r) => [r.id, r.reason]),
    );
    expect(reasons.get(scrubbed.id)).toBeNull();
    expect(reasons.get(kept.id)).toBe('sốt cao');
    expect(reasons.get(pending.id)).toBe('sốt cao');
  });

  it('D3: ghi chú quyết định của HR cũng NULL cùng mốc — kể cả đơn không có lý do', async () => {
    const noted = await leave('2025-10-30', '2025-10-30', 'REJECTED', null, 'đã xem giấy khám');
    const recent = await leave('2025-11-02', '2025-11-02', 'APPROVED', null, 'ok');
    await instance().job.execute();
    const notes = new Map(
      (await testPrisma().leaveRequest.findMany()).map((r) => [r.id, r.decisionNote]),
    );
    expect(notes.get(noted.id)).toBeNull();
    expect(notes.get(recent.id)).toBe('ok');
  });

  it('D4: xóa đơn + số dư theo CẢ năm (mốc 2024-12-01 ⇒ năm < 2024); năm 2024 giữ nguyên', async () => {
    await leave('2023-12-29', '2023-12-29', 'APPROVED');
    const sameYear = await leave('2024-01-02', '2024-01-02', 'APPROVED');
    for (const year of [2023, 2024]) {
      await testPrisma().leaveBalance.create({ data: { userId: user, year } });
    }
    await instance().job.execute();
    expect((await testPrisma().leaveRequest.findMany()).map((r) => r.id)).toEqual([sameYear.id]);
    expect((await testPrisma().leaveBalance.findMany()).map((b) => b.year)).toEqual([2024]);
  });

  it('D5 / D6 / D7: departures 730, thông báo 180, HrAuditLog 1826 ngày — biên ±1 ngày', async () => {
    const prisma = testPrisma();
    // Mốc 3.5: nhiệm kỳ công ty, mốc theo NGÀY `last_day` (cùng mốc với attendance).
    const dep = (lastDay: Date) =>
      prisma.companyMemberDeparture.create({
        data: {
          id: randomUUID(),
          userId: user,
          role: 'EMPLOYEE',
          firstDay: new Date(ago(2000).toISOString().slice(0, 10)),
          lastDay: new Date(lastDay.toISOString().slice(0, 10)),
          leftAt: lastDay,
          reason: 'OFFBOARDED',
        },
      });
    const note = (createdAt: Date) =>
      prisma.notification.create({
        data: {
          recipientId: user,
          type: 'ACCESS_CHANGED',
          refId: randomUUID(),
          createdAt,
        },
      });
    const audit = (createdAt: Date) =>
      prisma.hrAuditLog.create({
        data: { id: randomUUID(), actorId: user, action: 'GRANT', createdAt },
      });
    await Promise.all([dep(ago(731)), note(ago(181)), audit(ago(1827))]);
    const [depNew, noteNew, auditNew] = await Promise.all([
      dep(ago(729)),
      note(ago(179)),
      audit(ago(1825)),
    ]);
    await instance().job.execute();
    expect((await prisma.companyMemberDeparture.findMany()).map((r) => r.id)).toEqual([depNew.id]);
    expect((await prisma.notification.findMany()).map((r) => r.id)).toEqual([noteNew.id]);
    expect((await prisma.hrAuditLog.findMany()).map((r) => r.id)).toEqual([auditNew.id]);
  });

  it("D7': note quản trị bị bỏ khỏi before/after của audit quá 395 ngày; phần còn lại của dòng giữ nguyên", async () => {
    const prisma = testPrisma();
    const audit = (createdAt: Date) =>
      prisma.hrAuditLog.create({
        data: {
          id: randomUUID(),
          actorId: user,
          action: 'LEAVE_REVOKE',
          before: { status: 'APPROVED', note: 'cũ' },
          after: { status: 'REVOKED', note: 'đã xem giấy khám' },
          createdAt,
        },
      });
    const old = await audit(ago(396));
    const recent = await audit(ago(394));
    await instance().job.execute();
    const rows = new Map((await prisma.hrAuditLog.findMany()).map((r) => [r.id, r]));
    expect(rows.get(old.id)).toMatchObject({
      action: 'LEAVE_REVOKE',
      before: { status: 'APPROVED' },
      after: { status: 'REVOKED' },
    });
    expect(JSON.stringify([rows.get(old.id)?.before, rows.get(old.id)?.after])).not.toContain(
      'note',
    );
    expect(rows.get(recent.id)?.after).toEqual({ status: 'REVOKED', note: 'đã xem giấy khám' });
  });

  it('theo lô: 5 dòng, lô 2 ⇒ đủ qua nhiều lô; chạy lại ⇒ 0 thay đổi (idempotent)', async () => {
    for (let i = 0; i < 5; i++) await event(ago(800 + i));
    const { job } = instance();
    const first = await job.execute({ batchSize: 2 });
    expect(first).toMatchObject({ busy: false, complete: true });
    expect(first.rows.attendance_events).toBe(5);
    expect(await testPrisma().attendanceEvent.count()).toBe(0);
    const again = await job.execute({ batchSize: 2 });
    expect(Object.values(again.rows).every((n) => n === 0)).toBe(true);
  });

  it('chạm trần lô ⇒ dừng, chưa complete; lượt sau làm tiếp', async () => {
    for (let i = 0; i < 5; i++) await event(ago(800 + i));
    const { job } = instance();
    // Lô 1 = D9 (đơn bổ sung — rỗng, T-055 chạy TRƯỚC D2), lô 2–3 = D2 xóa 4/5 lượt chấm ⇒ chạm trần, còn 1.
    expect(await job.execute({ batchSize: 2, maxBatches: 3 })).toMatchObject({
      batches: 3,
      complete: false,
    });
    expect(await testPrisma().attendanceEvent.count()).toBe(1);
    await job.execute({ batchSize: 2 });
    expect(await testPrisma().attendanceEvent.count()).toBe(0);
  });

  it('instance khác giữ khóa lô ⇒ busy, không đổi gì; log tổng kết chỉ có số đếm', async () => {
    const e = await event(ago(800));
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = testPrisma().$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${RETENTION_LOCK_KEY}, 0))`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;
    const { uow, stores } = instance();
    const logger = new SpyLogger();
    await retentionJob({ stores, policy: B, uow, clock: new FakeClock(NOW), logger }).run();
    release();
    await holder;

    const summary = logger.entries.find((x) => x.msg === 'maintenance.retention_summary')?.data;
    expect(summary).toMatchObject({ busy: true, batches: 0, complete: false });
    expect(JSON.stringify(summary)).not.toContain(e.id);
    expect(await testPrisma().attendanceEvent.count()).toBe(1);
  });

  it('signal đã hủy ⇒ không chạy lô nào', async () => {
    await event(ago(800));
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await instance().job.execute({ signal: ctrl.signal })).toMatchObject({ batches: 0 });
    expect(await testPrisma().attendanceEvent.count()).toBe(1);
  });
});
