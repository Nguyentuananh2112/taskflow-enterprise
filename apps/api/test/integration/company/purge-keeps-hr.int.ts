// CO-05 (test-spec-company §2, ADR-136): dữ liệu HR thuộc CÔNG TY, không thuộc workspace ⇒ purge workspace (T-033) xóa
// ws + project + task + membership nhưng KHÔNG đụng một dòng nào của chấm công / đơn / số dư / thông báo / HrAuditLog
// / nhiệm kỳ công ty. Đếm trước / sau trên Postgres thật.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaWorkspacePurger } from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-workspace.purger';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const NOW = new Date('2026-12-01T00:00:00.000Z');
const PAST = new Date('2026-11-01T00:00:00.000Z');
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

async function hrCounts() {
  const p = testPrisma();
  return {
    companyMembers: await p.companyMember.count(),
    departures: await p.companyMemberDeparture.count(),
    attendance: await p.attendanceEvent.count(),
    leaveRequests: await p.leaveRequest.count(),
    leaveBalances: await p.leaveBalance.count(),
    notifications: await p.notification.count(),
    hrAudit: await p.hrAuditLog.count(),
  };
}

describe('CO-05 purge workspace — bảng HR không đổi', () => {
  it('xóa ws hết ân hạn (cùng người là OWNER + nhân viên có dữ liệu HR) ⇒ đếm mọi bảng HR trước = sau', async () => {
    const p = testPrisma();
    const user = async (name: string) =>
      (
        await p.user.create({
          data: {
            email: `${name}-${randomUUID()}@example.test`,
            fullName: name,
            passwordHash: 'x',
          },
        })
      ).id;
    const mia = await user('mia');
    const hana = await user('hana');
    const quinn = await user('quinn');
    await p.companyMember.createMany({
      data: [
        { userId: mia, role: 'EMPLOYEE', startDate: day('2026-01-05') },
        { userId: hana, role: 'EMPLOYEE', grants: ['HR_MANAGE'], startDate: day('2026-01-05') },
      ],
    });
    await p.companyMemberDeparture.create({
      data: {
        id: randomUUID(),
        userId: quinn,
        role: 'EMPLOYEE',
        firstDay: day('2026-01-05'),
        lastDay: day('2026-06-30'),
        leftAt: PAST,
        reason: 'OFFBOARDED',
      },
    });
    await p.attendanceEvent.create({
      data: {
        id: randomUUID(),
        userId: mia,
        kind: 'IN',
        source: 'WEB',
        occurredAt: new Date('2026-10-20T01:00:00.000Z'),
        workDate: day('2026-10-20'),
        createdById: mia,
      },
    });
    const leave = await p.leaveRequest.create({
      data: {
        userId: mia,
        type: 'ANNUAL',
        startDate: day('2026-12-10'),
        endDate: day('2026-12-10'),
        reason: 'việc riêng',
      },
    });
    await p.leaveBalance.create({ data: { userId: mia, year: 2026 } });
    await p.notification.create({
      data: { recipientId: hana, type: 'LEAVE_SUBMITTED', refId: leave.id, actorId: mia },
    });
    await p.hrAuditLog.create({
      data: { id: randomUUID(), actorId: hana, action: 'LEAVE_APPROVE', targetUserId: mia },
    });

    const ws = await p.workspace.create({
      data: { name: 'Xóa', slug: `ws-${randomUUID().slice(0, 8)}`, deletedAt: PAST, purgeAt: PAST },
    });
    await p.workspaceMember.createMany({
      data: [
        { workspaceId: ws.id, userId: mia, role: 'OWNER' },
        { workspaceId: ws.id, userId: hana, role: 'MEMBER' },
      ],
    });
    const project = await p.project.create({
      data: { workspaceId: ws.id, name: 'P', keyPrefix: 'TF' },
    });
    await p.task.create({
      data: { workspaceId: ws.id, projectId: project.id, number: 1, title: 'T', rank: 'a0' },
    });

    const before = await hrCounts();
    expect(Object.values(before).every((n) => n > 0)).toBe(true);

    const uow = new RecordingUnitOfWork();
    const purged = await uow.run(() => new PrismaWorkspacePurger(() => uow.db()).purge(ws.id, NOW));
    expect(purged).toBe(true);
    expect(await p.workspace.findUnique({ where: { id: ws.id } })).toBeNull();
    expect(await p.workspaceMember.count({ where: { workspaceId: ws.id } })).toBe(0);
    expect(await p.task.count()).toBe(0);

    expect(await hrCounts()).toEqual(before);
  });
});
