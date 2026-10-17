import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client';

/** URL DB dành riêng cho integration — bắt buộc khác DB dev để không xóa nhầm dữ liệu. */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('Thiếu DATABASE_URL_TEST (integration cần Postgres thật)');
  if (url === process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_TEST trùng DATABASE_URL — từ chối chạy để không xóa DB dev');
  }
  return url;
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl() }) });
}

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    // holidays / companies không có FK tới users ⇒ CASCADE không dọn (A, T-063 @78884e3 — giữ khi gộp).
    'TRUNCATE task_audit_logs, tasks, projects, workspace_members, refresh_tokens, workspaces, users, holidays, companies CASCADE',
  );
}

/** Dữ liệu tối thiểu: 2 workspace, 1 user, mỗi workspace 1 project. */
export async function seedMinimal(prisma: PrismaClient) {
  const user = await prisma.user.create({
    data: { email: 'mia@example.test', fullName: 'Mia', passwordHash: 'x' },
  });
  const w1 = await prisma.workspace.create({ data: { name: 'W1', slug: 'w-one' } });
  const w2 = await prisma.workspace.create({ data: { name: 'W2', slug: 'w-two' } });
  const p1 = await prisma.project.create({
    data: { workspaceId: w1.id, name: 'P1', keyPrefix: 'TF' },
  });
  const q1 = await prisma.project.create({
    data: { workspaceId: w2.id, name: 'Q1', keyPrefix: 'TF' },
  });
  return { user, w1, w2, p1, q1 };
}
