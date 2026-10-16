// Backend Prisma cho harness leave (tầng I/C): repo Prisma + PrismaUnitOfWork trên Postgres thật — cùng hợp đồng
// `LeaveBackend` với bản InMemory. Lịch / membership / thông báo / audit vẫn là fake của harness.
import type { LeaveRequestRecord } from '../../../src/modules/leave/application/ports/leave.ports';
import { PrismaLeaveReadModel } from '../../../src/modules/leave/infrastructure/persistence/prisma/prisma-leave-read-model';
import { PrismaLeaveRepository } from '../../../src/modules/leave/infrastructure/persistence/prisma/prisma-leave.repository';
import type { LeaveBackend } from '../../../src/modules/leave/testing/leave-backend';
import { RecordingUnitOfWork, testPrisma } from '../support/prisma-test-kit';

export function prismaLeaveBackend(): LeaveBackend {
  const uow = new RecordingUnitOfWork();
  const requests = new PrismaLeaveRepository(() => uow.db());
  const prisma = testPrisma();
  return {
    uow,
    requests,
    readModel: new PrismaLeaveReadModel(() => uow.db()),
    async prepare({ workspaces, users }) {
      await prisma.user.createMany({
        data: users.map((id) => ({
          id,
          email: `${id.slice(-12)}@example.test`,
          fullName: id.slice(-4),
          passwordHash: 'x',
        })),
        skipDuplicates: true,
      });
      await prisma.workspace.createMany({
        data: workspaces.map((id) => ({
          id,
          name: `W ${id.slice(-4)}`,
          slug: `ws-${id.slice(-12)}`,
        })),
        skipDuplicates: true,
      });
    },
    seed: (record: LeaveRequestRecord) => requests.add(record),
    async rows() {
      const ids = await prisma.leaveRequest.findMany({
        select: { id: true, workspaceId: true },
        orderBy: { id: 'asc' },
      });
      const found = await Promise.all(ids.map((r) => requests.find(r.workspaceId, r.id)));
      return found.filter((r): r is LeaveRequestRecord => r !== null);
    },
  };
}
