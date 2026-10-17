// Workspace / dự án / task mẫu cho seed dev (T-010) — tách khỏi seed.ts từ Mốc 3.5 (ADR-138), nội dung không đổi.
import type { PrismaClient } from '../src/generated/prisma/client';
import type { TaskPriority, TaskStatus, WorkspaceRole } from '../src/generated/prisma/enums';

/** Khóa fractional-indexing hợp lệ (phần nguyên 1 chữ số base62: a0…az) — đủ cho ≤ 62 task/cột. */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rankAt = (i: number) => `a${BASE62[i]}`;

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

async function createWorkspace(
  prisma: PrismaClient,
  name: string,
  slug: string,
  members: [string, WorkspaceRole][],
): Promise<string> {
  const ws = await prisma.workspace.create({
    data: { name, slug, members: { create: members.map(([userId, role]) => ({ userId, role })) } },
  });
  return ws.id;
}

type TaskSeed = { title: string; createdBy: string; assignee?: string; deleted?: boolean };

async function createProject(
  prisma: PrismaClient,
  workspaceId: string,
  name: string,
  keyPrefix: string,
  tasks: TaskSeed[],
  archived = false,
) {
  const project = await prisma.project.create({
    data: { workspaceId, name, keyPrefix, nextTaskNumber: tasks.length + 1 },
  });
  const perColumn: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 };
  for (const [i, t] of tasks.entries()) {
    const status = STATUSES[i % STATUSES.length]!;
    const task = await prisma.task.create({
      data: {
        workspaceId,
        projectId: project.id,
        number: i + 1,
        title: t.title,
        status,
        priority: PRIORITIES[i % PRIORITIES.length]!,
        rank: rankAt(perColumn[status]++),
        assigneeId: t.assignee ?? null,
        createdById: t.createdBy,
        dueDate: i % 3 === 0 ? new Date(Date.UTC(2026, 10, 1 + i)) : null,
      },
    });
    await prisma.taskAuditLog.create({
      data: {
        workspaceId,
        projectId: project.id,
        taskId: task.id,
        actorId: t.createdBy,
        action: 'CREATED',
        // Hình dạng theo data-and-api §1.5.
        newValue: {
          number: task.number,
          title: task.title,
          status,
          priority: task.priority,
          rank: task.rank,
          dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
          assigneeId: task.assigneeId,
        },
      },
    });
    if (t.deleted) {
      // Xóa mềm như DeleteTask: version + 1, audit DELETED (R10, D1).
      await prisma.task.update({
        where: { id: task.id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await prisma.taskAuditLog.create({
        data: {
          workspaceId,
          projectId: project.id,
          taskId: task.id,
          actorId: t.createdBy,
          action: 'DELETED',
          oldValue: { title: task.title, status },
        },
      });
    }
  }
  if (archived) {
    await prisma.project.update({ where: { id: project.id }, data: { archivedAt: new Date() } });
  }
  return project.id;
}

/** Hai workspace: Olivia (Admin) là OWNER ws thứ nhất, KHÔNG ở ws thứ hai — Admin không có quyền ngầm. */
export async function seedWorkspaces(
  prisma: PrismaClient,
  u: Record<'Olivia' | 'Pam' | 'Mia' | 'Max' | 'Vic' | 'Otto', string>,
) {
  const w1 = await createWorkspace(prisma, 'Nhóm Sản phẩm', 'nhom-san-pham', [
    [u.Olivia, 'OWNER'],
    [u.Pam, 'PM'],
    [u.Mia, 'MEMBER'],
    [u.Max, 'MEMBER'],
    [u.Vic, 'VIEWER'],
  ]);
  await createWorkspace(prisma, 'Đối tác', 'doi-tac', [
    [u.Otto, 'OWNER'],
    [u.Mia, 'VIEWER'],
  ]);
  const creators = [u.Olivia, u.Pam, u.Mia, u.Max];
  const assignees = [u.Mia, u.Max, u.Pam, undefined];
  const active = Array.from({ length: 26 }, (_, i) => ({
    title: `Công việc mẫu số ${i + 1}`,
    createdBy: creators[i % creators.length]!,
    ...(assignees[i % assignees.length] ? { assignee: assignees[i % assignees.length]! } : {}),
    ...(i === 25 ? { deleted: true } : {}),
  }));
  await createProject(prisma, w1, 'TaskFlow Web', 'TF', active);
  await createProject(
    prisma,
    w1,
    'Dự án cũ',
    'ARC',
    Array.from({ length: 4 }, (_, i) => ({ title: `Việc đã lưu trữ ${i + 1}`, createdBy: u.Pam })),
    true,
  );
}
