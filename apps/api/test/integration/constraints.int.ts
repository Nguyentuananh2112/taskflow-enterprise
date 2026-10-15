import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, seedMinimal, testDatabaseUrl, truncateAll } from './db';
import { runPrisma } from './global-setup';

const prisma: PrismaClient = createTestPrisma();
let ctx: Awaited<ReturnType<typeof seedMinimal>>;

beforeEach(async () => {
  await truncateAll(prisma);
  ctx = await seedMinimal(prisma);
});
afterAll(() => prisma.$disconnect());

const task = (over: Record<string, unknown> = {}) => ({
  workspaceId: ctx.w1.id,
  projectId: ctx.p1.id,
  number: 1,
  title: 'Việc',
  rank: 'a0',
  ...over,
});

describe('migration khớp schema (ADR-062)', () => {
  it('migrate diff giữa DB đã migrate và schema.prisma rỗng', () => {
    expect(() =>
      runPrisma(
        [
          'migrate',
          'diff',
          '--from-config-datasource',
          '--to-schema',
          'prisma/schema.prisma',
          '--exit-code',
        ],
        testDatabaseUrl(),
      ),
    ).not.toThrow();
  });
});

describe('tasks', () => {
  it('UC-CR21: cột rank dùng collation "C"', async () => {
    const rows = await prisma.$queryRaw<{ collation_name: string }[]>`
      SELECT collation_name FROM information_schema.columns
       WHERE table_name = 'tasks' AND column_name = 'rank'`;
    expect(rows[0]?.collation_name).toBe('C');
  });

  it('UC-MV23: ORDER BY rank so byte (chữ hoa trước chữ thường, "a0" < "a0V" < "a1")', async () => {
    const ranks = ['a1', 'a0V', 'aZ', 'a0', 'aa'];
    for (const [i, rank] of ranks.entries()) {
      await prisma.task.create({ data: task({ number: i + 1, rank }) });
    }
    const sorted = await prisma.task.findMany({ orderBy: { rank: 'asc' }, select: { rank: true } });
    expect(sorted.map((t) => t.rank)).toEqual(['a0', 'a0V', 'a1', 'aZ', 'aa']);
  });

  it('UC-CR22: trùng (project, status, rank) giữa task chưa xóa ⇒ lỗi unique', async () => {
    await prisma.task.create({ data: task() });
    await expect(prisma.task.create({ data: task({ number: 2 }) })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('UC-DL12: task đã xóa mềm không giữ chỗ rank', async () => {
    await prisma.task.create({ data: task({ deletedAt: new Date() }) });
    await expect(prisma.task.create({ data: task({ number: 2 }) })).resolves.toBeDefined();
  });

  it('cùng rank ở cột khác hợp lệ', async () => {
    await prisma.task.create({ data: task() });
    await expect(
      prisma.task.create({ data: task({ number: 2, status: 'DONE' }) }),
    ).resolves.toBeDefined();
  });

  it('UC-CR18: unique (project, number); cùng số ở project khác hợp lệ', async () => {
    await prisma.task.create({ data: task() });
    await expect(prisma.task.create({ data: task({ rank: 'a1' }) })).rejects.toMatchObject({
      code: 'P2002',
    });
    await expect(
      prisma.task.create({ data: task({ workspaceId: ctx.w2.id, projectId: ctx.q1.id }) }),
    ).resolves.toBeDefined();
  });

  it('UC-CR20: FK kép chặn task có workspace_id lệch với project', async () => {
    await expect(
      prisma.task.create({ data: task({ workspaceId: ctx.w2.id }) }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('CHECK: number và version ≥ 1, rank không rỗng', async () => {
    for (const bad of [{ number: 0 }, { version: 0 }, { rank: '' }]) {
      await expect(prisma.task.create({ data: task(bad) })).rejects.toThrow();
    }
  });
});

describe('ràng buộc khác', () => {
  it('users.email phải là chữ thường', async () => {
    await expect(
      prisma.user.create({
        data: { email: 'Max@Example.test', fullName: 'Max', passwordHash: 'x' },
      }),
    ).rejects.toThrow(/users_email_lowercase_chk/);
  });

  it('workspaces: slug sai định dạng và deleted_at/purge_at lệch nhau bị chặn', async () => {
    await expect(
      prisma.workspace.create({ data: { name: 'X', slug: 'Bad_Slug' } }),
    ).rejects.toThrow(/workspaces_slug_format_chk/);
    await expect(
      prisma.workspace.create({ data: { name: 'X', slug: 'x-ws', deletedAt: new Date() } }),
    ).rejects.toThrow(/workspaces_soft_delete_chk/);
  });

  it('projects: key_prefix sai định dạng; trùng prefix trong workspace', async () => {
    await expect(
      prisma.project.create({ data: { workspaceId: ctx.w1.id, name: 'X', keyPrefix: 'tf' } }),
    ).rejects.toThrow(/projects_key_prefix_format_chk/);
    await expect(
      prisma.project.create({ data: { workspaceId: ctx.w1.id, name: 'X', keyPrefix: 'TF' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('UC-AU07: không xóa được user còn audit log (FK Restrict, D3)', async () => {
    const t = await prisma.task.create({ data: task() });
    await prisma.taskAuditLog.create({
      data: {
        workspaceId: ctx.w1.id,
        projectId: ctx.p1.id,
        taskId: t.id,
        actorId: ctx.user.id,
        action: 'CREATED',
      },
    });
    await expect(prisma.user.delete({ where: { id: ctx.user.id } })).rejects.toThrow();
  });

  it('index partial của workspaces tồn tại đúng điều kiện', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'workspaces_purge_at_idx'`;
    expect(rows[0]?.indexdef).toMatch(/WHERE \(purge_at IS NOT NULL\)/);
  });
});
