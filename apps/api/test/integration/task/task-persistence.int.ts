// Tầng I của test-spec-task.md — phần LSP (chạy lại test use case trên Prisma) không bắt được:
// bộ đếm số trên DB thật, thứ tự SQL dưới collation "C", phạm vi tenant của truy vấn đọc, xóa mềm.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ResourceNotFoundError } from '../../../src/core/errors';
import {
  createTaskHarness,
  P1,
  Q1,
  U,
  W2,
  type TaskHarness,
} from '../../../src/modules/task/testing/task-harness';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';
import { prismaTaskBackend } from './prisma-task-backend';

let h: TaskHarness;
beforeEach(async () => {
  await resetDatabase();
  h = await createTaskHarness(prismaTaskBackend());
});
afterAll(disconnectTestPrisma);

const create = (title: string, scope = h.scope('Mia')) =>
  h.create.execute({ ...scope, input: { title } });

describe('cấp số TF-n trên Postgres (§3.1)', () => {
  it('UC-CR16: next_task_number = 7 ⇒ task số 7, bộ đếm thành 8', async () => {
    await h.backend.patchProject(P1, { nextTaskNumber: 7 });
    const dto = await create('Số bảy');
    expect(dto).toMatchObject({ number: 7, key: 'TF-7' });
    expect((await h.project(P1)).nextTaskNumber).toBe(8);
  });

  it('UC-CR17: số của task đã xóa mềm không bị tái sử dụng', async () => {
    await h.seedTask({ rank: 'a0', number: 5, deletedAt: new Date() });
    expect((await create('Sau xóa')).number).toBe(6);
  });

  it('UC-CR18: P1 (W1) và Q1 (W2) cùng prefix TF đều có TF-1', async () => {
    const a = await create('Ở P1');
    const b = await create('Ở Q1', {
      workspaceId: W2,
      projectId: Q1,
      actor: { userId: U.Otto, role: 'OWNER' },
    });
    expect([a.key, b.key]).toEqual(['TF-1', 'TF-1']);
  });

  it('UC-CR19: audit lỗi sau khi đã INSERT task ⇒ DB không còn task, bộ đếm không đổi', async () => {
    h.deps.audit.append = () => Promise.reject(new Error('audit down'));
    await expect(create('Hỏng')).rejects.toThrow('audit down');
    expect(await testPrisma().task.count()).toBe(0);
    expect((await h.project(P1)).nextTaskNumber).toBe(1);
  });
});

describe('rank & thứ tự SQL (§3.2, ADR-011/062)', () => {
  it('UC-MV23: danh sách sắp bằng SQL dưới collation "C" — chữ hoa trước chữ thường', async () => {
    const ranks = ['a1', 'a0V', 'aZ', 'a0', 'aa'];
    for (const rank of ranks) await h.seedTask({ rank });
    const res = await h.queries.listTasks({ ...h.scope('Mia'), query: { limit: 50 } });
    expect(res.items.map((t) => t.rank)).toEqual(['a0', 'a0V', 'a1', 'aZ', 'aa']);
  });

  it('UC-MV23: move với fractional-indexing thật giữ đúng thứ tự trong DB', async () => {
    const [a, b, c] = [
      await h.seedTask({ rank: 'a0' }),
      await h.seedTask({ rank: 'a1' }),
      await h.seedTask({ rank: 'a2' }),
    ];
    await h.move.execute({
      ...h.scope('Mia'),
      taskId: c.id,
      input: { expectedVersion: 1, afterId: a.id },
    });
    await h.move.execute({
      ...h.scope('Mia'),
      taskId: a.id,
      input: { expectedVersion: 1, beforeId: b.id },
    });
    const res = await h.queries.listTasks({
      ...h.scope('Mia'),
      query: { limit: 50, status: 'TODO' },
    });
    expect(res.items.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
  });

  it('UC-UP11: update đổi updated_at và chỉ ghi khi version khớp', async () => {
    const t = await h.seedTask({ rank: 'a0' });
    h.clock.advance(60_000);
    await h.update.execute({
      ...h.scope('Mia'),
      taskId: t.id,
      input: { expectedVersion: 1, title: 'Đổi tên' },
    });
    const row = await h.row(t.id);
    expect(row.updatedAt.toISOString()).toBe('2026-10-15T08:01:00.000Z');
    expect(row.version).toBe(2);
    expect(
      await h.deps.tasks.save((await h.deps.tasks.findLive(row.workspaceId, P1, t.id))!, 1),
    ).toBe(false);
  });
});

describe('xóa mềm (§3.5, R16)', () => {
  it('UC-DL11..DL13: task đã xóa biến khỏi danh sách/chi tiết/lệnh ghi, rank được giải phóng, lịch sử còn', async () => {
    const t = await h.seedTask({ rank: 'a0' });
    await h.remove.execute({ ...h.scope('Mia'), taskId: t.id, input: {} });
    const list = await h.queries.listTasks({ ...h.scope('Mia'), query: { limit: 50 } });
    expect(list.items).toHaveLength(0);
    await expect(h.queries.getTask({ ...h.scope('Mia'), taskId: t.id })).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    await expect(
      h.update.execute({
        ...h.scope('Mia'),
        taskId: t.id,
        input: { expectedVersion: 2, title: 'Ma' },
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      h.assign.execute({
        ...h.scope('Pam'),
        taskId: t.id,
        input: { expectedVersion: 2, assigneeId: U.Max },
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect((await create('Thế chỗ')).rank).toBe('a0');
    const audit = await h.queries.listAuditLogs({
      ...h.scope('Mia'),
      taskId: t.id,
      query: { limit: 10 },
    });
    expect(audit.items.map((a) => a.action)).toEqual(['DELETED']);
  });
});

describe('truy vấn đọc trên SQL (§3.6/§3.7)', () => {
  it('UC-LS05: task bị move lên đầu giữa hai trang ⇒ không lỗi, cursor theo khóa (có thể sót/lặp — đúng thiết kế)', async () => {
    const ids: string[] = [];
    for (const rank of ['a0', 'a1', 'a2', 'a3']) ids.push((await h.seedTask({ rank })).id);
    const page1 = await h.queries.listTasks({ ...h.scope('Mia'), query: { limit: 2 } });
    await h.move.execute({
      ...h.scope('Mia'),
      taskId: ids[3]!,
      input: { expectedVersion: 1, beforeId: ids[0]! },
    });
    const page2 = await h.queries.listTasks({
      ...h.scope('Mia'),
      query: { limit: 2, cursor: page1.page.nextCursor! },
    });
    expect(page2.items.map((t) => t.id)).toEqual([ids[2]]);
    expect(page2.page.hasMore).toBe(false);
  });

  it('UC-AU04: actor đã ẩn danh hóa vẫn hiện trong lịch sử với tên thay thế (FK Restrict, D3)', async () => {
    const dto = await create('Có lịch sử');
    await testPrisma().taskAuditLog.updateMany({
      where: { taskId: dto.id },
      data: { actorId: U.Zed },
    });
    const audit = await h.queries.listAuditLogs({
      ...h.scope('Vic'),
      taskId: dto.id,
      query: { limit: 10 },
    });
    expect(audit.items[0]?.actor).toEqual({ id: U.Zed, fullName: 'Người dùng đã xóa' });
  });

  it('workspace đã xóa mềm ⇒ mọi đọc/ghi task là 404 (ADR-047)', async () => {
    const t = await h.seedTask({ rank: 'a0' });
    await testPrisma().workspace.updateMany({
      data: { deletedAt: new Date(), purgeAt: new Date(Date.now() + 86_400_000) },
      where: { id: t.workspaceId },
    });
    await expect(
      h.queries.listTasks({ ...h.scope('Mia'), query: { limit: 50 } }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      h.move.execute({
        ...h.scope('Mia'),
        taskId: t.id,
        input: { expectedVersion: 1, status: 'IN_PROGRESS' },
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(await h.backend.readModel.taskExists(t.workspaceId, P1, t.id)).toBe(false);
  });
});
