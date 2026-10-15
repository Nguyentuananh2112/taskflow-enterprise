import {
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskMovedEvent,
  TaskUpdatedEvent,
} from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { createTaskHarness, U, type TaskHarness } from '../testing/task-harness';

// test-spec-task.md §3.8 (RT-*) + §3.7 UC-AU08. Gateway T-016 bọc `data` vào vỏ RealtimeEnvelope
// (eventId/occurredAt do gateway sinh — RT-07 phần vỏ test ở core/realtime); ở đây kiểm data +
// meta, và ráp lại vỏ để khẳng định khớp schema contracts mà FE dùng.
const envelope = (h: TaskHarness, i = 0) => {
  const [input, meta] = h.emitted()[i]!.args as [
    { type: string; data: unknown },
    { actorId: string; originClientId: string | null },
  ];
  return {
    eventId: '0199e5a2-0000-7000-8000-00000000e001',
    occurredAt: '2026-10-15T08:00:00.000Z',
    type: input.type,
    actorId: meta.actorId,
    originClientId: meta.originClientId,
    data: input.data,
  };
};

async function lifecycle() {
  const h = await createTaskHarness();
  const scope = h.scope('Pam', undefined, { clientId: '0199e5a2-0000-7000-8000-00000000c001' });
  const t = await h.create.execute({ ...scope, input: { title: 'Vòng đời' } });
  await h.update.execute({
    ...scope,
    taskId: t.id,
    input: { expectedVersion: 1, priority: 'HIGH' },
  });
  await h.move.execute({
    ...scope,
    taskId: t.id,
    input: { expectedVersion: 2, status: 'IN_PROGRESS' },
  });
  // No-op: đã là task cuối (duy nhất) của cột ⇒ không event, không audit.
  await h.move.execute({
    ...scope,
    taskId: t.id,
    input: { expectedVersion: 3, status: 'IN_PROGRESS', beforeId: null },
  });
  const other = await h.seedTask({ rank: 'Zz', status: 'IN_PROGRESS' });
  await h.move.execute({
    ...scope,
    taskId: t.id,
    input: { expectedVersion: 3, beforeId: other.id },
  });
  await h.assign.execute({
    ...scope,
    taskId: t.id,
    input: { expectedVersion: 4, assigneeId: U.Max },
  });
  await h.remove.execute({ ...scope, taskId: t.id, input: {} });
  return { h, t };
}

describe('domain event → realtime (RT-*)', () => {
  it('RT-01..RT-06: mỗi use case đúng một event, khớp schema contracts', async () => {
    const { h } = await lifecycle();
    expect(h.emitted().map((c) => (c.args[0] as { type: string }).type)).toEqual([
      'task:created',
      'task:updated',
      'task:moved',
      'task:moved',
      'task:updated',
      'task:deleted',
    ]);
    expect(TaskCreatedEvent.safeParse(envelope(h, 0)).success).toBe(true);
    expect(TaskUpdatedEvent.parse(envelope(h, 1)).data.changedFields).toEqual(['priority']);
    const statusChange = TaskMovedEvent.parse(envelope(h, 2)).data;
    expect(statusChange.from.status).toBe('TODO');
    expect(statusChange.to.status).toBe('IN_PROGRESS');
    const sameColumn = TaskMovedEvent.parse(envelope(h, 3)).data;
    expect(sameColumn.from.status).toBe(sameColumn.to.status);
    expect(TaskUpdatedEvent.parse(envelope(h, 4)).data.changedFields).toEqual(['assignee']);
    expect(TaskDeletedEvent.parse(envelope(h, 5)).data).toMatchObject({ key: 'TF-1', version: 6 });
  });

  it('RT-01: DTO trong event là bản SAU khi ghi (version đúng); phát sau commit, vào đúng project', async () => {
    const { h, t } = await lifecycle();
    const versions = h
      .emitted()
      .slice(0, 5)
      .map((c) => (c.args[0] as { data: { task: { version: number } } }).data.task.version);
    expect(versions).toEqual([1, 2, 3, 4, 5]);
    for (const c of h.emitted()) {
      expect(c.duringTransaction).toBe(false);
      expect(c.args[0]).toMatchObject({ projectId: t.projectId });
      expect(c.args[1]).toEqual({
        actorId: U.Pam,
        originClientId: '0199e5a2-0000-7000-8000-00000000c001',
      });
    }
  });

  it('RT-08 + UC-AU08: rollback/no-op/lỗi ⇒ không event, 0 audit; thay đổi thật ⇒ đúng 1 audit', async () => {
    const { h, t } = await lifecycle();
    expect((await h.auditOf(t.id)).map((a) => a.action)).toEqual([
      'CREATED',
      'UPDATED',
      'STATUS_CHANGED',
      'MOVED',
      'ASSIGNEE_CHANGED',
      'DELETED',
    ]);
    expect(h.events.types()).toEqual([
      'TaskCreated',
      'TaskUpdated',
      'TaskStatusChanged',
      'TaskMoved',
      'TaskAssigneeChanged',
      'TaskDeleted',
    ]);
    const live = await h.seedTask({ rank: 'a5', assigneeId: U.Max });
    const before = h.emitted().length;
    await h.assign.execute({
      ...h.scope('Pam'),
      taskId: live.id,
      input: { expectedVersion: 1, assigneeId: U.Max },
    });
    await h.update
      .execute({
        ...h.scope('Pam'),
        taskId: live.id,
        input: { expectedVersion: 9, title: 'Sai version' },
      })
      .catch(() => undefined);
    expect(h.emitted()).toHaveLength(before);
    expect(await h.auditOf(live.id)).toHaveLength(0);
  });

  it('notifier lỗi ⇒ lệnh vẫn thành công, log task.realtime_failed, domain event vẫn publish', async () => {
    const h = await createTaskHarness();
    h.deps.notifier = { emitToProject: () => Promise.reject(new Error('socket down')) };
    await expect(
      h.create.execute({ ...h.scope('Mia'), input: { title: 'Mất mạng' } }),
    ).resolves.toMatchObject({ number: 1 });
    expect(h.logger.messages('error')).toContain('task.realtime_failed');
    expect(h.events.types()).toEqual(['TaskCreated']);
  });
});
