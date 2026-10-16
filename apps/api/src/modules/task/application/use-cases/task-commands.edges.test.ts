import { describe, expect, it, vi } from 'vitest';

import { RankConflictError } from '../ports/task-repository.port';
import { createTaskHarness, U } from '../../testing/task-harness';

// F3 (mutation, report §4.2): nhánh lỗi dùng chung của TaskCommands + guard của assign/update/delete
// mà mutant còn sống (T-9, T-20, T-21, T-22, T-26).
describe('TaskCommands — nhánh lỗi (F3 mutation)', () => {
  it('T-9: `save` thua vì task vừa bị xóa ⇒ 404 task (không TypeError 500)', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0' });
    const save = h.deps.tasks.save.bind(h.deps.tasks);
    h.deps.tasks.save = async (task, expectedVersion, opts) => {
      await h.patchTask(task.id, { deletedAt: new Date(), version: 9 });
      return save(task, expectedVersion, opts);
    };
    await expect(
      h.update.execute({
        ...h.scope('Mia'),
        taskId: t.id,
        input: { expectedVersion: 1, title: 'Tiêu đề mới' },
      }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'task' } });
  });

  it('T-20: `save` thua và project biến mất ⇒ 404 project (không TypeError 500)', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0' });
    const find = h.deps.projects.findInWorkspace.bind(h.deps.projects);
    let saved = false;
    h.deps.tasks.save = () => {
      saved = true;
      return Promise.resolve(false);
    };
    h.deps.projects.findInWorkspace = (key) => (saved ? Promise.resolve(null) : find(key));
    await expect(
      h.update.execute({
        ...h.scope('Mia'),
        taskId: t.id,
        input: { expectedVersion: 1, title: 'Tiêu đề mới' },
      }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'project' } });
  });

  it('T-20: rebalance ghi thiếu dòng và project biến mất ⇒ 404 project', async () => {
    const h = await createTaskHarness();
    const LONG = `a0${'V'.repeat(70)}`;
    await h.seedTask({ rank: LONG });
    const c = await h.seedTask({ rank: `${LONG}V` });
    const x = await h.seedTask({ rank: 'a0', status: 'IN_PROGRESS' });
    const find = h.deps.projects.findInWorkspace.bind(h.deps.projects);
    let short = false;
    h.deps.tasks.saveRanks = () => {
      short = true;
      return Promise.resolve(0);
    };
    h.deps.projects.findInWorkspace = (key) => (short ? Promise.resolve(null) : find(key));
    await expect(
      h.move.execute({
        ...h.scope('Mia'),
        taskId: x.id,
        input: { expectedVersion: 1, status: 'TODO', beforeId: c.id },
      }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'project' } });
  });

  it('T-21: trùng rank quá giới hạn thử ⇒ 409 kèm `details { field: rank, reason: RANK_COLLISION }`', async () => {
    const h = await createTaskHarness();
    h.deps.tasks.add = () => Promise.reject(new RankConflictError());
    await expect(
      h.create.execute({ ...h.scope('Mia'), input: { title: 'Đụng rank' } }),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { field: 'rank', reason: 'RANK_COLLISION' },
    });
  });

  it('T-22: 403 của assign/update/delete mang đúng quyền thiếu', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', createdById: U.Pam });
    const scope = (p: 'Mia' | 'Vic') => ({ ...h.scope(p), taskId: t.id });
    await expect(
      h.assign.execute({ ...scope('Mia'), input: { expectedVersion: 1, assigneeId: U.Max } }),
    ).rejects.toMatchObject({ statusCode: 403, details: { required: 'task:assign:any' } });
    await expect(
      h.update.execute({ ...scope('Vic'), input: { expectedVersion: 1, title: 'Tiêu đề mới' } }),
    ).rejects.toMatchObject({ statusCode: 403, details: { required: 'task:update' } });
    await expect(h.remove.execute({ ...scope('Mia'), input: {} })).rejects.toMatchObject({
      statusCode: 403,
      details: { required: 'task:delete:any' },
    });
  });

  it('T-26: gán lại đúng người đang được gán ⇒ no-op, không ghi DB', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', assigneeId: U.Mia });
    const save = vi.spyOn(h.deps.tasks, 'save');
    const dto = await h.assign.execute({
      ...h.scope('Mia'),
      taskId: t.id,
      input: { expectedVersion: 1, assigneeId: U.Mia },
    });
    expect(dto.version).toBe(1);
    expect(save).not.toHaveBeenCalled();
  });
});
