// Seed dữ liệu GIẢ cho môi trường dev (T-010). Chạy: `pnpm --filter @taskflow/api db:seed`.
// Không có PII thật; email dùng tên miền dành riêng `example.test`. Xóa sạch dữ liệu cũ trước khi seed.
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import type { TaskPriority, TaskStatus, WorkspaceRole } from '../src/generated/prisma/enums';
import { Argon2idPasswordHasher } from '../src/modules/auth/infrastructure/security/argon2id-password-hasher';

// eslint-disable-next-line no-restricted-properties -- script CLI ngoài app, không qua loadEnv của server
const { DATABASE_URL, NODE_ENV, SEED_PASSWORD } = process.env;
if (!DATABASE_URL) throw new Error('Thiếu DATABASE_URL');
if (NODE_ENV === 'production') throw new Error('Không seed dữ liệu giả vào production');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

/**
 * Mật khẩu chung của mọi user mẫu — CHỈ cho dev local (đã chặn production ở trên), qua được
 * PasswordPolicy (≥ 12 ký tự, không phổ biến, không chứa phần local của email). Đổi bằng SEED_PASSWORD.
 */
const DEV_PASSWORD = SEED_PASSWORD ?? 'TaskFlow-dev-2026';

const PEOPLE = ['Olivia', 'Pam', 'Mia', 'Max', 'Vic', 'Otto'] as const;
type Person = (typeof PEOPLE)[number];

/** Khóa fractional-indexing hợp lệ (phần nguyên 1 chữ số base62: a0…az) — đủ cho ≤ 62 task/cột. */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rankAt = (i: number) => `a${BASE62[i]}`;

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE task_audit_logs, tasks, projects, workspace_members, refresh_tokens, workspaces, users CASCADE',
  );
}

async function createUsers() {
  // Băm một lần (argon2id ~46 MiB/lần, ADR-065) rồi dùng chung cho mọi user mẫu.
  const passwordHash = await (await Argon2idPasswordHasher.create()).hash(DEV_PASSWORD);
  const users = {} as Record<Person, string>;
  for (const name of PEOPLE) {
    const u = await prisma.user.create({
      data: {
        email: `${name.toLowerCase()}@example.test`,
        fullName: `${name} (dữ liệu mẫu)`,
        passwordHash,
      },
    });
    users[name] = u.id;
  }
  return users;
}

async function createWorkspace(
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

async function main() {
  await reset();
  const u = await createUsers();
  const w1 = await createWorkspace('Công ty Mẫu', 'cong-ty-mau', [
    [u.Olivia, 'OWNER'],
    [u.Pam, 'PM'],
    [u.Mia, 'MEMBER'],
    [u.Max, 'MEMBER'],
    [u.Vic, 'VIEWER'],
  ]);
  await createWorkspace('Đối tác', 'doi-tac', [
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
  await createProject(w1, 'TaskFlow Web', 'TF', active);
  await createProject(
    w1,
    'Dự án cũ',
    'ARC',
    Array.from({ length: 4 }, (_, i) => ({ title: `Việc đã lưu trữ ${i + 1}`, createdBy: u.Pam })),
    true,
  );
  console.info(
    'Seed xong: 6 user (mật khẩu dev chung), 2 workspace, 2 project (1 archived), 30 task (1 đã xóa mềm).',
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
