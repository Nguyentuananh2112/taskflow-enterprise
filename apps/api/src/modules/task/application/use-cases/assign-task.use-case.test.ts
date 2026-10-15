import { describe, expect, it } from 'vitest';

import type { VersionConflictError } from '../../../../core/errors';
import {
  BusinessRuleViolationError,
  ForbiddenError,
  ProjectArchivedError,
} from '../../../../core/errors';
import {
  createTaskHarness,
  P1,
  P2,
  P3,
  U,
  W1,
  W2,
  Q1,
  type Person,
  type TaskHarness,
} from '../../testing/task-harness';

// test-spec-task.md §3.3 (tầng A).
const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );
const rule = (e: unknown) => (e as BusinessRuleViolationError).details?.rule;
const ref = (p: Person) => ({ id: U[p], fullName: p });

describe('AssignTaskUseCase', () => {
  it('UC-AS01: PM gán ⇒ v2, audit ASSIGNEE_CHANGED, realtime task:updated ["assignee"]', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', createdById: U.Pam });
    const dto = await h.assign.execute({
      ...h.scope('Pam'),
      taskId: t.id,
      input: { expectedVersion: 1, assigneeId: U.Max },
    });
    expect(dto).toMatchObject({ assignee: ref('Max'), version: 2 });
    expect(await h.auditOf(t.id)).toEqual([
      expect.objectContaining({
        action: 'ASSIGNEE_CHANGED',
        oldValue: { assigneeId: null },
        newValue: { assigneeId: U.Max },
      }),
    ]);
    expect(h.emitted()[0]?.args[0]).toEqual({
      projectId: P1,
      type: 'task:updated',
      data: { task: dto, changedFields: ['assignee'] },
    });
  });

  it.each([
    ['TP-A01', 'Pam', 'Mia', null, 'Max', true],
    ['TP-A03', 'Mia', 'Mia', null, 'Max', true],
    ['TP-A05', 'Mia', 'Pam', null, 'Mia', true],
    ['TP-A06', 'Mia', 'Pam', 'Mia', null, true],
    ['TP-A07', 'Mia', 'Pam', null, 'Max', false],
    ['TP-A08', 'Mia', 'Pam', 'Max', 'Mia', false],
    ['TP-A10', 'Mia', 'Pam', 'Mia', 'Max', false],
    ['TP-A11', 'Vic', 'Pam', null, 'Vic', false],
  ] as const)(
    'UC-AS02 (%s): %s, task(%s → %s) gán %s ⇒ %s',
    async (_, who, creator, current, target, ok) => {
      const h = await createTaskHarness();
      const t = await h.seedTask({
        rank: 'a0',
        createdById: U[creator],
        assigneeId: current ? U[current] : null,
      });
      const run = h.assign.execute({
        ...h.scope(who),
        taskId: t.id,
        input: { expectedVersion: 1, assigneeId: target ? U[target] : null },
      });
      if (ok) await expect(run).resolves.toMatchObject({ version: 2 });
      else await expect(run).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it.each([
    ['UC-AS03', U.Vic],
    ['UC-AS04', U.Otto],
    ['UC-AS05', U.Zed],
    ['UC-AS06', '0199e5a2-0000-7000-8000-00000000abcd'],
  ])(
    '%s: gán cho người không đủ điều kiện ⇒ 422 ASSIGNEE_NOT_MEMBER (không 404)',
    async (_, target) => {
      const h = await createTaskHarness();
      const t = await h.seedTask({ rank: 'a0' });
      const err = await errorOf(
        h.assign.execute({
          ...h.scope('Pam'),
          taskId: t.id,
          input: { expectedVersion: 1, assigneeId: target },
        }),
      );
      expect(err).toBeInstanceOf(BusinessRuleViolationError);
      expect(rule(err)).toBe('ASSIGNEE_NOT_MEMBER');
    },
  );

  it('UC-AS07: gán lại đúng người ⇒ no-op, không audit/event', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', assigneeId: U.Max });
    const dto = await h.assign.execute({
      ...h.scope('Pam'),
      taskId: t.id,
      input: { expectedVersion: 1, assigneeId: U.Max },
    });
    expect(dto.version).toBe(1);
    expect(await h.auditOf(t.id)).toHaveLength(0);
    expect(h.emitted()).toHaveLength(0);
  });

  it('UC-AS08: version cũ ⇒ 409 + details.current', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', version: 2 });
    const err = await errorOf(
      h.assign.execute({
        ...h.scope('Pam'),
        taskId: t.id,
        input: { expectedVersion: 1, assigneeId: U.Max },
      }),
    );
    expect((err as VersionConflictError).details).toMatchObject({
      currentVersion: 2,
      current: { id: t.id },
    });
  });

  it('UC-AS09: policy chặn trước version (403, không 409)', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0', createdById: U.Pam, assigneeId: U.Max });
    await expect(
      h.assign.execute({
        ...h.scope('Mia'),
        taskId: t.id,
        input: { expectedVersion: 9, assigneeId: U.Mia },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('UC-AS10..AS12: archived ⇒ 422 PROJECT_ARCHIVED (trước luật assignee); VIEWER ⇒ 403', async () => {
    const h = await createTaskHarness();
    const arc = await h.seedTask({ rank: 'a0', projectId: P2 });
    const run = (who: Person, assigneeId: string) =>
      h.assign.execute({
        ...h.scope(who, P2),
        taskId: arc.id,
        input: { expectedVersion: 1, assigneeId },
      });
    await expect(run('Pam', U.Max)).rejects.toBeInstanceOf(ProjectArchivedError);
    await expect(run('Vic', U.Max)).rejects.toBeInstanceOf(ForbiddenError);
    await h.backend.setMember({ workspaceId: W1, userId: U.Max, role: 'VIEWER' });
    await expect(run('Pam', U.Max)).rejects.toBeInstanceOf(ProjectArchivedError);
  });
});

// §3.3 "Bỏ gán khi mất quyền nhận việc" — phía Task của port ITaskAssignmentCleaner (ADR-093).
describe('TaskAssignmentCleaner.unassignAllForUser', () => {
  async function assigned() {
    const h = await createTaskHarness();
    const t = {
      tf1: await h.seedTask({ rank: 'a0', assigneeId: U.Max }),
      tf4: await h.seedTask({ rank: 'a0', projectId: P3, assigneeId: U.Max }),
      arc1: await h.seedTask({ rank: 'a0', projectId: P2, assigneeId: U.Max }),
      tf9: await h.seedTask({ rank: 'a1', assigneeId: U.Max, deletedAt: new Date() }),
      other: await h.seedTask({ rank: 'a2', assigneeId: U.Mia }),
    };
    return { h, t };
  }
  const unassign = (h: TaskHarness, actorId: string, workspaceId = W1) =>
    h.uow.run(() => h.cleaner.unassignAllForUser({ workspaceId, userId: U.Max, actorId }));

  it.each([
    ['UC-UN01 (Olivia hạ role)', U.Olivia],
    ['UC-UN02 (Pam xóa khỏi ws)', U.Pam],
    ['UC-UN03 (Max tự rời)', U.Max],
  ])(
    '%s: bỏ gán mọi task sống của Max, kể cả project archived (ADR-092); audit actor = người thao tác',
    async (_, actorId) => {
      {
        const { h, t } = await assigned();
        expect(await unassign(h, actorId)).toEqual({ unassignedTaskCount: 3 });
        for (const task of [t.tf1, t.tf4, t.arc1]) {
          expect(await h.row(task.id)).toMatchObject({ assigneeId: null, version: 2 });
          expect(await h.auditOf(task.id)).toEqual([
            expect.objectContaining({
              action: 'ASSIGNEE_CHANGED',
              actorId,
              oldValue: { assigneeId: U.Max },
              newValue: { assigneeId: null },
            }),
          ]);
        }
        expect(await h.row(t.tf9.id)).toMatchObject({ assigneeId: U.Max, version: 1 });
        expect((await h.row(t.other.id)).assigneeId).toBe(U.Mia);
      }
    },
  );

  it('UC-UN04: task của Max ở workspace khác không bị đụng', async () => {
    const { h } = await assigned();
    await h.backend.setMember({ workspaceId: W2, userId: U.Max, role: 'MEMBER' });
    const q = await h.seedTask({ rank: 'a0', projectId: Q1, assigneeId: U.Max });
    await unassign(h, U.Olivia);
    expect((await h.row(q.id)).assigneeId).toBe(U.Max);
  });

  it('UC-UN05: không có task ⇒ 0, không ghi gì', async () => {
    const h = await createTaskHarness();
    expect(await unassign(h, U.Olivia)).toEqual({ unassignedTaskCount: 0 });
    expect(await h.allAudit()).toHaveLength(0);
  });

  it('UC-UN06 (phần Task): sau commit mỗi task một task:updated ["assignee"], không có originClientId', async () => {
    const { h } = await assigned();
    await unassign(h, U.Olivia);
    const calls = h.emitted();
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.duringTransaction).toBe(false);
      expect(c.args[0]).toMatchObject({
        type: 'task:updated',
        data: { changedFields: ['assignee'] },
      });
      expect(c.args[1]).toEqual({ actorId: U.Olivia, originClientId: null });
    }
  });

  it('UC-UN07: audit lỗi ở task thứ 2 ⇒ rollback toàn bộ (cùng transaction của bên gọi)', async () => {
    const { h, t } = await assigned();
    let n = 0;
    const append = h.deps.audit.append.bind(h.deps.audit);
    h.deps.audit.append = (e) => (++n === 2 ? Promise.reject(new Error('audit down')) : append(e));
    await expect(unassign(h, U.Olivia)).rejects.toThrow('audit down');
    for (const task of [t.tf1, t.tf4, t.arc1])
      expect(await h.row(task.id)).toMatchObject({ assigneeId: U.Max, version: 1 });
    expect(await h.allAudit()).toHaveLength(0);
    expect(h.emitted()).toHaveLength(0);
  });
});
