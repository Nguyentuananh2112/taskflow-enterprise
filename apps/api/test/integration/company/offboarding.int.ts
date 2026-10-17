// T-062 tầng I: vòng đời nghỉ việc trên Postgres thật — repo Prisma (schedule / cancel / DELETE … RETURNING / departed),
// hai lượt hoàn tất đua nhau ⇒ đúng một departure, và thứ tự khóa ADR-136 (D HIGH-1): một giao dịch đang giữ
// `taskflow:leave:<U>` rồi FOR SHARE dòng U (như submit đơn) chạy song song với hoàn tất ⇒ không deadlock.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { CompanyAccess } from '../../../src/modules/company/application/company-access';
import { HrAuditWriter } from '../../../src/modules/company/application/hr-audit-writer';
import type { ICompanyAccounts } from '../../../src/modules/company/application/ports/accounts.port';
import type { EmploymentCollaborators } from '../../../src/modules/company/application/ports/employment-collaborators.port';
import { AdminAccessUseCases } from '../../../src/modules/company/application/use-cases/admin-access.use-cases';
import { CompleteOffboardingUseCase } from '../../../src/modules/company/application/use-cases/complete-offboarding.use-case';
import {
  CancelOffboardingUseCase,
  ScheduleOffboardingUseCase,
} from '../../../src/modules/company/application/use-cases/offboarding.use-cases';
import { AppError } from '../../../src/core/errors';
import { PrismaCompanyMembers } from '../../../src/modules/company/infrastructure/prisma/prisma-company';
import { PrismaCompanyOffboarding } from '../../../src/modules/company/infrastructure/prisma/prisma-company-offboarding';
import { PrismaHrAuditLog } from '../../../src/modules/company/infrastructure/prisma/prisma-hr-audit-log';
import { UuidV7Generator } from '../../../src/core/infrastructure/system';
import { FakeClock, SpyLogger } from '../../support';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const NOW = '2026-11-02T00:00:00.000Z'; // 07:00 02/11 giờ VN
const DUE = new Date('2026-11-01T23:00:00.000Z'); // 06:00 02/11 giờ VN — ngày làm cuối 01/11
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

let hr: string;
let mia: string;

beforeEach(async () => {
  await resetDatabase();
  const p = testPrisma();
  const user = async (name: string) =>
    (
      await p.user.create({
        data: { email: `${name}-${randomUUID()}@example.test`, fullName: name, passwordHash: 'x' },
      })
    ).id;
  hr = await user('hr');
  mia = await user('mia');
  await p.companyMember.createMany({
    data: [
      { userId: hr, role: 'EMPLOYEE', grants: ['HR_MANAGE'], startDate: day('2026-01-05') },
      { userId: mia, role: 'EMPLOYEE', startDate: day('2026-10-01') },
    ],
  });
});
afterAll(disconnectTestPrisma);

function offboardingDeps() {
  const uow = new RecordingUnitOfWork();
  const db = () => uow.db();
  const clock = new FakeClock(NOW);
  const ids = new UuidV7Generator();
  const members = new PrismaCompanyMembers(db);
  const collaborators: EmploymentCollaborators = {
    workspaceExit: {
      endMembership: () => Promise.resolve({ workspaceIds: [], orphaned: [] }),
      soleOwnerWorkspaces: () => Promise.resolve([]),
    },
    offboardLeave: { offboardCleanup: () => Promise.resolve({ cancelled: 0, revoked: 0 }) },
    rehireLeave: {
      resetOnRehire: () => Promise.resolve(false),
      pendingCount: () => Promise.resolve(0),
    },
    notifier: { notify: () => Promise.resolve() },
    realtime: { notifyCompanyAccessChanged: () => Promise.resolve() },
  };
  const accounts = {
    revokeActivations: () => Promise.resolve(0),
    revokeSessions: () => Promise.resolve(),
  } as unknown as ICompanyAccounts;
  return {
    access: new CompanyAccess({ members, clock }),
    members,
    offboarding: new PrismaCompanyOffboarding(db),
    accounts,
    collaborators: () => collaborators,
    audit: new HrAuditWriter({ hrAudit: new PrismaHrAuditLog(db), ids, clock }),
    uow,
    ids,
    clock,
    timeZone: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    logger: new SpyLogger(),
  };
}

const completer = () => new CompleteOffboardingUseCase(offboardingDeps());

const scheduleDue = () =>
  testPrisma().companyMember.update({
    where: { userId: mia },
    data: {
      offboardLastDay: day('2026-11-01'),
      offboardAccessUntil: DUE,
      offboardScheduledById: hr,
    },
  });

describe('PrismaCompanyOffboarding', () => {
  it('schedule / cancel tăng version; cancel không có lịch ⇒ null; deleteIfDue theo mốc tham số (không now() DB)', async () => {
    const uow = new RecordingUnitOfWork();
    const repo = new PrismaCompanyOffboarding(() => uow.db());
    const at = new Date(NOW);
    const s = await uow.run(() =>
      repo.schedule({
        userId: mia,
        lastDay: '2026-11-01',
        accessUntil: DUE,
        scheduledById: hr,
        at,
      }),
    );
    expect(s).toMatchObject({
      offboardLastDay: '2026-11-01',
      offboardAccessUntil: DUE,
      version: 2,
    });
    expect(await uow.run(() => repo.listDue(new Date(DUE.getTime() - 1), 10))).toEqual([]);
    expect(await uow.run(() => repo.listDue(DUE, 10))).toEqual([mia]);
    expect(await uow.run(() => repo.cancel(mia, at))).toMatchObject({
      offboardLastDay: null,
      offboardAccessUntil: null,
      version: 3,
    });
    expect(await uow.run(() => repo.cancel(mia, at))).toBeNull();
    await scheduleDue();
    expect(await uow.run(() => repo.deleteIfDue(mia, new Date(DUE.getTime() - 1)))).toBeNull();
    expect(await uow.run(() => repo.deleteIfDue(mia, DUE))).toMatchObject({
      userId: mia,
      startDate: '2026-10-01',
      offboardLastDay: '2026-11-01',
    });
    expect(await testPrisma().companyMember.findUnique({ where: { userId: mia } })).toBeNull();
  });

  it('listDeparted: nhiệm kỳ cuối của người không còn dòng; người đang làm (nhận lại) không có', async () => {
    const p = testPrisma();
    const dep = (userId: string, first: string, last: string) =>
      p.companyMemberDeparture.create({
        data: {
          id: randomUUID(),
          userId,
          role: 'EMPLOYEE',
          firstDay: day(first),
          lastDay: day(last),
          leftAt: new Date(NOW),
          reason: 'OFFBOARDED',
        },
      });
    await dep(mia, '2025-01-01', '2025-03-01');
    await dep(mia, '2025-05-01', '2025-08-01');
    await dep(hr, '2024-01-01', '2024-02-01'); // hr vẫn đang làm ⇒ không LEFT
    await p.companyMember.delete({ where: { userId: mia } });
    const uow = new RecordingUnitOfWork();
    const repo = new PrismaCompanyOffboarding(() => uow.db());
    expect(await uow.run(() => repo.listDeparted())).toEqual([
      { userId: mia, firstDay: '2025-05-01', lastDay: '2025-08-01' },
    ]);
  });
});

describe('CompleteOffboardingUseCase trên Postgres', () => {
  it('hai lượt đua nhau (request ‖ job) ⇒ đúng một true, đúng một departure', async () => {
    await scheduleDue();
    const results = await Promise.all([completer().completeOne(mia), completer().completeOne(mia)]);
    expect(results.sort()).toEqual([false, true]);
    expect(await testPrisma().companyMemberDeparture.count({ where: { userId: mia } })).toBe(1);
  });

  it('D HIGH-1: giao dịch giữ leave:<U> rồi FOR SHARE dòng U ‖ hoàn tất ⇒ cả hai xong, không deadlock (40P01)', async () => {
    await scheduleDue();
    let release!: () => void;
    const holding = new Promise<void>((r) => (release = r));
    const submit = testPrisma().$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`taskflow:leave:${mia}`}, 0))`;
        release();
        await new Promise((r) => setTimeout(r, 300)); // hoàn tất đã bắt đầu và đang chờ khóa leave
        const rows = await tx.$queryRaw<{ user_id: string }[]>`
          SELECT user_id FROM company_members WHERE user_id = ${mia}::uuid FOR SHARE`;
        return rows.length;
      },
      { timeout: 20_000 },
    );
    await holding;
    const [seen, completed] = await Promise.all([submit, completer().completeOne(mia)]);
    expect(seen).toBe(1); // submit thấy dòng (hoàn tất chờ khóa leave, chưa xóa)
    expect(completed).toBe(true);
    expect(await testPrisma().companyMember.findUnique({ where: { userId: mia } })).toBeNull();
  });
});

describe('A review T-062 HIGH-1: lên lịch nghỉ cho Admin ‖ PUT /admin/access hạ chính Admin đó', () => {
  it('thứ tự khóa company:admins → dòng ở cả hai lệnh ⇒ không deadlock (40P01) / 500 qua nhiều lượt', async () => {
    const p = testPrisma();
    const admin = async (name: string) => {
      const u = await p.user.create({
        data: { email: `${name}-${randomUUID()}@example.test`, fullName: name, passwordHash: 'x' },
      });
      await p.companyMember.create({ data: { userId: u.id, role: 'ADMIN' } });
      return u.id;
    };
    const [a, b, x] = [await admin('a'), await admin('b'), await admin('x')];
    for (let round = 0; round < 8; round += 1) {
      await p.companyMember.update({
        where: { userId: x },
        data: {
          role: 'ADMIN',
          startDate: null,
          offboardLastDay: null,
          offboardAccessUntil: null,
          offboardScheduledById: null,
        },
      });
      const version = (await p.companyMember.findUniqueOrThrow({ where: { userId: x } })).version;
      const sd = offboardingDeps();
      const schedule = new ScheduleOffboardingUseCase(sd, new CompleteOffboardingUseCase(sd));
      const ad = offboardingDeps();
      const access = new AdminAccessUseCases({
        access: ad.access,
        members: ad.members,
        accounts: {
          profiles: () => Promise.resolve(new Map()),
          revokeSessions: () => Promise.resolve(),
        },
        audit: ad.audit,
        offboardLeave: { offboardCleanup: () => Promise.resolve({ cancelled: 0, revoked: 0 }) },
        events: {
          accessChanged: () => Promise.resolve(),
          pushAccessChanged: () => Promise.resolve(),
        },
        uow: ad.uow,
        ids: ad.ids,
        clock: ad.clock,
        timeZone: ad.timeZone,
      });
      const results = await Promise.allSettled([
        schedule.execute({ actorId: b, userId: x, lastDay: '2026-11-20' }),
        access.set({
          actorId: a,
          userId: x,
          role: 'EMPLOYEE',
          grants: [],
          expectedVersion: version,
        }),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') {
          // Chỉ được thua bằng lỗi nghiệp vụ (409 version / 403 / 404) — không phải deadlock / lỗi DB.
          expect(r.reason, String(r.reason)).toBeInstanceOf(AppError);
          expect((r.reason as AppError).statusCode).toBeLessThan(500);
        }
      }
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    }
  }, 120_000);
});

describe('F CC-HR-18: PUT lên lịch (ngày làm cuối đã qua ⇒ hoàn tất ngay) ‖ DELETE hủy lịch', () => {
  it('một bên thắng nhất quán qua 20 lượt: LEFT + DELETE 409/404, hoặc DELETE thắng rồi PUT áp sau (LEFT) — không bao giờ PUT 200 mà vẫn còn làm', async () => {
    const p = testPrisma();
    for (let round = 0; round < 20; round += 1) {
      await resetDatabase();
      const hrId = (
        await p.user.create({
          data: { email: `hr-${randomUUID()}@example.test`, fullName: 'hr', passwordHash: 'x' },
        })
      ).id;
      const u = (
        await p.user.create({
          data: { email: `u-${randomUUID()}@example.test`, fullName: 'u', passwordHash: 'x' },
        })
      ).id;
      await p.companyMember.createMany({
        data: [
          { userId: hrId, role: 'EMPLOYEE', grants: ['HR_MANAGE'], startDate: day('2026-01-05') },
          {
            userId: u,
            role: 'EMPLOYEE',
            startDate: day('2026-10-01'),
            offboardLastDay: day('2026-11-05'),
            offboardAccessUntil: new Date('2026-11-05T23:00:00.000Z'),
            offboardScheduledById: hrId,
          },
        ],
      });
      const sd = offboardingDeps();
      const put = new ScheduleOffboardingUseCase(sd, new CompleteOffboardingUseCase(sd));
      const del = new CancelOffboardingUseCase(offboardingDeps());
      const [a, b] = await Promise.allSettled([
        put.execute({ actorId: hrId, userId: u, lastDay: '2026-11-01' }),
        del.execute({ actorId: hrId, userId: u }),
      ]);
      const row = await p.companyMember.findUnique({ where: { userId: u } });
      const departures = await p.companyMemberDeparture.count({ where: { userId: u } });
      if (a.status === 'fulfilled') {
        // PUT báo thành công ⇒ người đó PHẢI đã nghỉ, đúng một departure.
        expect(a.value.completed, `vòng ${round}`).toBe(true);
        expect(row, `vòng ${round}`).toBeNull();
        expect(departures).toBe(1);
        if (b.status === 'rejected') {
          expect((b.reason as AppError).statusCode, String(b.reason)).toBeLessThan(500);
        }
      } else {
        expect((a.reason as AppError).statusCode, String(a.reason)).toBeLessThan(500);
        expect(b.status).toBe('fulfilled');
        expect(row?.offboardLastDay ?? null).toBeNull();
        expect(departures).toBe(0);
      }
    }
  }, 180_000);
});
