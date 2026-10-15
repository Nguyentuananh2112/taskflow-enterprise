import { describe, expect, it } from 'vitest';

import {
  ForbiddenError,
  ProjectArchivedError,
  ResourceNotFoundError,
  VersionConflictError,
} from '../../../../core/errors';
import { Task } from '../../domain/task';
import { createTaskHarness, P1, P2, U, W2, type TaskHarness } from '../../testing/task-harness';

// test-spec-task.md §3.4 (UpdateTask) và §3.5 (DeleteTask), tầng A.
describe('UpdateTaskUseCase', () => {
  it('UC-UP01/UP03: MEMBER sửa task người khác tạo ⇒ v2, audit UPDATED chỉ trường đổi, task:updated', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', title: 'Cũ', createdById: U.Pam });
    const dto = await h.update.execute({
      ...h.scope('Mia'),
      taskId: t.id,
      input: { expectedVersion: 1, title: 'Mới tinh' },
    });
    expect(dto).toMatchObject({ title: 'Mới tinh', version: 2 });
    expect(await h.auditOf(t.id)).toEqual([
      expect.objectContaining({
        action: 'UPDATED',
        oldValue: { title: 'Cũ' },
        newValue: { title: 'Mới tinh' },
      }),
    ]);
    expect(h.emitted()[0]?.args[0]).toMatchObject({
      type: 'task:updated',
      data: { changedFields: ['title'] },
    });
  });

  it('UC-UP02: audit description chỉ lưu { changed, length }, không lưu nội dung', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', description: 'x'.repeat(500) });
    await h.update.execute({
      ...h.scope('Mia'),
      taskId: t.id,
      input: { expectedVersion: 1, description: 'Nội dung mới' },
    });
    const [row] = await h.auditOf(t.id);
    expect(row?.oldValue).toEqual({ description: { changed: true, length: 500 } });
    expect(row?.newValue).toEqual({ description: { changed: true, length: 12 } });
    expect(JSON.stringify(row)).not.toContain('Nội dung mới');
  });

  it('UC-UP04/UP05: VIEWER ⇒ 403; project archived ⇒ 422', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0' });
    const arc = await h.seedTask({ rank: 'a0', projectId: P2 });
    await expect(
      h.update.execute({
        ...h.scope('Vic'),
        taskId: t.id,
        input: { expectedVersion: 1, title: 'Viewer' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      h.update.execute({
        ...h.scope('Mia', P2),
        taskId: arc.id,
        input: { expectedVersion: 1, title: 'Lưu trữ' },
      }),
    ).rejects.toBeInstanceOf(ProjectArchivedError);
  });

  it('UC-UP06: giá trị y hệt ⇒ no-op, không audit/event/version', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', title: 'Giữ nguyên', priority: 'HIGH' });
    const dto = await h.update.execute({
      ...h.scope('Mia'),
      taskId: t.id,
      input: { expectedVersion: 1, title: ' Giữ nguyên ', priority: 'HIGH' },
    });
    expect(dto.version).toBe(1);
    expect(await h.auditOf(t.id)).toHaveLength(0);
    expect(h.emitted()).toHaveLength(0);
  });

  it('UC-UP07: version cũ ⇒ 409 + current', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', version: 3 });
    const err = await h.update
      .execute({ ...h.scope('Mia'), taskId: t.id, input: { expectedVersion: 2, title: 'Muộn' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VersionConflictError);
    expect((err as VersionConflictError).details).toMatchObject({
      currentVersion: 3,
      current: { version: 3 },
    });
  });

  it('UC-UP08/UP09: dueDate quá khứ được; null xóa cả dueDate và description', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', description: 'Có', dueDate: '2026-12-01' });
    const past = await h.update.execute({
      ...h.scope('Mia'),
      taskId: t.id,
      input: { expectedVersion: 1, dueDate: '2020-01-01' },
    });
    expect(past.dueDate).toBe('2020-01-01');
    const cleared = await h.update.execute({
      ...h.scope('Mia'),
      taskId: t.id,
      input: { expectedVersion: 2, dueDate: null, description: null },
    });
    expect(cleared).toMatchObject({ dueDate: null, description: null, version: 3 });
    expect(h.emitted()[1]?.args[0]).toMatchObject({
      data: { changedFields: ['description', 'dueDate'] },
    });
  });

  it('UC-UP10: task đã xóa mềm ⇒ 404', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', deletedAt: new Date() });
    await expect(
      h.update.execute({
        ...h.scope('Mia'),
        taskId: t.id,
        input: { expectedVersion: 1, title: 'Ma' },
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('chỉ 4 trường được sửa lọt vào entity (field lạ trong input bị bỏ qua)', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0' });
    const input = { expectedVersion: 1, title: 'Hợp lệ', createdById: U.Otto, status: 'DONE' };
    await h.update.execute({ ...h.scope('Mia'), taskId: t.id, input });
    expect(await h.row(t.id)).toMatchObject({ createdById: U.Mia, status: 'TODO' });
  });
});

describe('DeleteTaskUseCase', () => {
  it('UC-DL01: xóa task của mình ⇒ { id, version+1 }, audit DELETED, realtime task:deleted', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', version: 3, title: 'Bỏ', createdById: U.Mia });
    const res = await h.remove.execute({ ...h.scope('Mia'), taskId: t.id, input: {} });
    expect(res).toEqual({ id: t.id, version: 4 });
    expect((await h.row(t.id)).deletedAt).not.toBeNull();
    expect(await h.auditOf(t.id)).toEqual([
      expect.objectContaining({
        action: 'DELETED',
        oldValue: { title: 'Bỏ', status: 'TODO' },
        newValue: null,
      }),
    ]);
    expect(h.emitted()[0]?.args[0]).toEqual({
      projectId: P1,
      type: 'task:deleted',
      data: { taskId: t.id, projectId: P1, key: `TF-${t.number}`, version: 4 },
    });
  });

  it.each([
    ['UC-DL02', 'Max', U.Mia, false],
    ['UC-DL03', 'Pam', U.Mia, true],
    ['UC-DL04 (MEMBER)', 'Mia', null, false],
    ['UC-DL04 (PM)', 'Pam', null, true],
    ['UC-DL05', 'Vic', U.Vic, false],
  ] as const)('%s: %s xóa task tạo bởi %s ⇒ %s', async (_, who, createdById, ok) => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', createdById });
    const run = h.remove.execute({ ...h.scope(who), taskId: t.id, input: {} });
    if (ok) await expect(run).resolves.toMatchObject({ version: 2 });
    else await expect(run).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('UC-DL06/DL07: archived ⇒ 422 (ADR-045); VIEWER ⇒ 403', async () => {
    const h = await createTaskHarness();
    const arc = await h.seedTask({ rank: 'a0', projectId: P2, createdById: U.Mia });
    await expect(
      h.remove.execute({ ...h.scope('Mia', P2), taskId: arc.id, input: {} }),
    ).rejects.toBeInstanceOf(ProjectArchivedError);
    await expect(
      h.remove.execute({ ...h.scope('Vic', P2), taskId: arc.id, input: {} }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('UC-DL08/DL09: expectedVersion sai ⇒ 409; đúng ⇒ 200', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', version: 3 });
    await expect(
      h.remove.execute({ ...h.scope('Mia'), taskId: t.id, input: { expectedVersion: 2 } }),
    ).rejects.toBeInstanceOf(VersionConflictError);
    await expect(
      h.remove.execute({ ...h.scope('Mia'), taskId: t.id, input: { expectedVersion: 3 } }),
    ).resolves.toEqual({ id: t.id, version: 4 });
  });

  it('UC-DL10: xóa lần nữa ⇒ 404', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0' });
    await h.remove.execute({ ...h.scope('Mia'), taskId: t.id, input: {} });
    await expect(
      h.remove.execute({ ...h.scope('Mia'), taskId: t.id, input: {} }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('task đã xóa giải phóng rank (unique partial): task mới cùng rank ở TODO được', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0' });
    await h.remove.execute({ ...h.scope('Mia'), taskId: t.id, input: {} });
    const dto = await h.create.execute({ ...h.scope('Mia'), input: { title: 'Thế chỗ' } });
    expect(dto.rank).toBe('a0');
  });
});

// T-028 (audit bảo mật của B): ghi phải nguyên tử theo archive + có phạm vi tenant ngay trong UPDATE.
describe('ghi có điều kiện archive + tenant (T-028 L1/L2)', () => {
  type Write = (h: TaskHarness, taskId: string) => Promise<unknown>;
  const writes: [string, Write][] = [
    [
      'update',
      (h, taskId) =>
        h.update.execute({
          ...h.scope('Mia'),
          taskId,
          input: { expectedVersion: 1, title: 'Sau archive' },
        }),
    ],
    [
      'move',
      (h, taskId) =>
        h.move.execute({
          ...h.scope('Mia'),
          taskId,
          input: { expectedVersion: 1, status: 'IN_PROGRESS' },
        }),
    ],
    [
      'assign',
      (h, taskId) =>
        h.assign.execute({
          ...h.scope('Pam'),
          taskId,
          input: { expectedVersion: 1, assigneeId: U.Max },
        }),
    ],
    ['delete', (h, taskId) => h.remove.execute({ ...h.scope('Mia'), taskId, input: {} })],
  ];

  it.each(writes)(
    'L1 %s: project bị archive SAU khi use case đã đọc ⇒ 422 PROJECT_ARCHIVED, task không đổi, không audit/event',
    async (_, write) => {
      const h = await createTaskHarness();
      const t = await h.seedTask({ rank: 'a0', createdById: U.Mia });
      const save = h.deps.tasks.save.bind(h.deps.tasks);
      // Đúng khe race: archive commit giữa lúc kiểm assertWritable và lúc UPDATE task.
      h.deps.tasks.save = async (task, expected, opts) => {
        await h.backend.patchProject(P1, { archivedAt: new Date() });
        return save(task, expected, opts);
      };
      await expect(write(h, t.id)).rejects.toBeInstanceOf(ProjectArchivedError);
      expect(await h.row(t.id)).toMatchObject({
        version: 1,
        title: t.title,
        status: 'TODO',
        assigneeId: null,
        deletedAt: null,
      });
      expect(await h.auditOf(t.id)).toHaveLength(0);
      expect(h.emitted()).toHaveLength(0);
    },
  );

  it('L2: save với task mang workspace/project khác dòng trong DB ⇒ không ghi', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0' });
    const forged = Task.reconstitute({ ...(await h.row(t.id)), workspaceId: W2, title: 'Giả mạo' });
    expect(await h.deps.tasks.save(forged, 1)).toBe(false);
    expect((await h.row(t.id)).title).toBe(t.title);
  });
});
