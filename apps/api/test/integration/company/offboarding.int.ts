// T-062 tầng I: vòng đời nghỉ việc trên Postgres thật — repo Prisma (schedule / cancel / DELETE … RETURNING / departed),
// hai lượt hoàn tất đua nhau ⇒ đúng một departure, và thứ tự khóa ADR-136 (D HIGH-1): một giao dịch đang giữ
// `taskflow:leave:<U>` rồi FOR SHARE dòng U (như submit đơn) chạy song song với hoàn tất ⇒ không deadlock.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { CompanyAccess } from '../../../src/modules/company/application/company-access';
import { HrAuditWriter } from '../../../src/modules/company/application/hr-audit-writer';
import type { ICompanyAccounts } from '../../../src/modules/company/application/ports/accounts.port';
import type { EmploymentCollaborators } from '../../../src/modules/company/application/ports/employment-collaborators.port';
import { CompleteOffboardingUseCase } from '../../../src/modules/company/application/use-cases/complete-offboarding.use-case';
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

function completer() {
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
  return new CompleteOffboardingUseCase({
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
  });
}

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
