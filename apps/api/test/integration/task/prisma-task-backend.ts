// Backend Prisma cho harness test của Task (LSP, T-023): cùng hợp đồng `TaskBackend` với bản
// InMemory ⇒ chạy lại nguyên bộ test use case trên Postgres thật. Port liên module dùng đúng
// adapter Prisma sẽ wire ở production (Workspace/Auth hiện thực — T-020).
import { PrismaUserRefReader } from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-user-ref.reader';
import type { TaskAuditEntry } from '../../../src/modules/task/application/ports/audit-log.port';
import type { TaskProps } from '../../../src/modules/task/domain/task';
import {
  fromDateOnly,
  toDateOnly,
} from '../../../src/modules/task/infrastructure/persistence/prisma/db';
import { PrismaTaskAuditLogRepository } from '../../../src/modules/task/infrastructure/persistence/prisma/prisma-task-audit-log.repository';
import { PrismaTaskReadModel } from '../../../src/modules/task/infrastructure/persistence/prisma/prisma-task-read-model';
import { PrismaTaskRepository } from '../../../src/modules/task/infrastructure/persistence/prisma/prisma-task.repository';
import type { TaskBackend } from '../../../src/modules/task/testing/task-backend';
import {
  PrismaAssigneeDirectory,
  PrismaTaskProjectStore,
} from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-task-ports';
import { RecordingUnitOfWork, testPrisma } from '../support/prisma-test-kit';

const rowToProps = (
  r: Awaited<ReturnType<ReturnType<typeof testPrisma>['task']['findFirstOrThrow']>>,
): TaskProps => ({
  ...r,
  dueDate: toDateOnly(r.dueDate),
});

/** Cột ngày trong patch ⇒ kiểu DB. */
function taskData(p: Partial<TaskProps>) {
  const { dueDate, ...rest } = p;
  return { ...rest, ...(dueDate !== undefined ? { dueDate: fromDateOnly(dueDate) } : {}) };
}

export function prismaTaskBackend(): TaskBackend & { uow: RecordingUnitOfWork } {
  const uow = new RecordingUnitOfWork();
  const db = () => uow.db();
  const prisma = testPrisma();
  return {
    uow,
    tasks: new PrismaTaskRepository(db),
    projects: new PrismaTaskProjectStore(db),
    assignees: new PrismaAssigneeDirectory(db),
    users: new PrismaUserRefReader(db),
    audit: new PrismaTaskAuditLogRepository(db),
    readModel: new PrismaTaskReadModel(db),

    async seedUser(u) {
      await prisma.user.create({
        data: {
          id: u.id,
          email: `${u.id}@example.test`,
          fullName: u.fullName,
          passwordHash: 'x',
          deletedAt: u.deletedAt,
        },
      });
    },
    async seedWorkspace(id) {
      await prisma.workspace.create({
        data: { id, name: `W ${id.slice(-4)}`, slug: `ws-${id.slice(-12)}` },
      });
    },
    async seedMember(m) {
      await prisma.workspaceMember.create({ data: m });
    },
    async seedProject(p) {
      await prisma.project.create({ data: { ...p, name: p.keyPrefix } });
    },
    async insertTask(t) {
      await prisma.task.create({
        data: taskData(t) as Parameters<typeof prisma.task.create>[0]['data'],
      });
    },

    async taskRows() {
      const rows = await prisma.task.findMany({ orderBy: { id: 'asc' } });
      return rows.map(rowToProps);
    },
    async patchTask(id, patch) {
      await prisma.task.update({ where: { id }, data: taskData(patch) });
    },
    async auditRows(): Promise<TaskAuditEntry[]> {
      const rows = await prisma.taskAuditLog.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map((r) => ({
        ...r,
        oldValue: r.oldValue as TaskAuditEntry['oldValue'],
        newValue: r.newValue as TaskAuditEntry['newValue'],
      }));
    },
    async projectRow(id) {
      const r = await prisma.project.findUnique({ where: { id } });
      return r
        ? {
            id: r.id,
            workspaceId: r.workspaceId,
            keyPrefix: r.keyPrefix,
            nextTaskNumber: r.nextTaskNumber,
            archivedAt: r.archivedAt,
          }
        : undefined;
    },
    async patchProject(id, patch) {
      await prisma.project.update({ where: { id }, data: patch });
    },
    async setMember(m) {
      await prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: m.workspaceId, userId: m.userId } },
        create: m,
        update: { role: m.role },
      });
    },
  };
}
