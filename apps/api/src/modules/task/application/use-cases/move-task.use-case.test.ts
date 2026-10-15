import { describe, expect, it } from 'vitest';

import {
  BusinessRuleViolationError,
  ForbiddenError,
  InvalidStatusTransitionError,
  ProjectArchivedError,
  ResourceNotFoundError,
  VersionConflictError,
} from '../../../../core/errors';
import { createTaskHarness, P2, P3, U, type TaskHarness } from '../../testing/task-harness';

// test-spec-task.md §3.2 (tầng A, rankGen thật). Bối cảnh: TODO [A a0, B a1, C a2], IN_PROGRESS [D a5, E a6].
// Spec ghi D "b0", E "b1" — không phải khóa fractional-indexing hợp lệ (đầu "b" cần 2 chữ số) nên đổi.
function board() {
  const h = createTaskHarness();
  const t = {
    A: h.seedTask({ rank: 'a0' }),
    B: h.seedTask({ rank: 'a1' }),
    C: h.seedTask({ rank: 'a2' }),
    D: h.seedTask({ rank: 'a5', status: 'IN_PROGRESS' }),
    E: h.seedTask({ rank: 'a6', status: 'IN_PROGRESS', createdById: U.Pam, assigneeId: U.Max }),
  };
  return { h, t };
}

const column = (h: TaskHarness, status: string) =>
  [...h.db.state.tasks.values()]
    .filter((x) => x.status === status && x.deletedAt === null)
    .sort((a, b) => (a.rank < b.rank ? -1 : 1))
    .map((x) => x.id);

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

describe('MoveTaskUseCase', () => {
  it('UC-MV01: sang cột khác sau D ⇒ rank ∈ (D, E), v2, audit STATUS_CHANGED, realtime task:moved', async () => {
    const { h, t } = board();
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.A.id,
      input: { expectedVersion: 1, status: 'IN_PROGRESS', afterId: t.D.id },
    });
    expect(dto).toMatchObject({ status: 'IN_PROGRESS', version: 2 });
    expect(dto.rank > 'a5' && dto.rank < 'a6').toBe(true);
    expect(h.auditOf(t.A.id)).toEqual([
      expect.objectContaining({
        action: 'STATUS_CHANGED',
        oldValue: { status: 'TODO', rank: 'a0' },
        newValue: { status: 'IN_PROGRESS', rank: dto.rank },
      }),
    ]);
    expect(h.emitted()[0]?.args[0]).toEqual({
      projectId: t.A.projectId,
      type: 'task:moved',
      data: {
        task: dto,
        from: { status: 'TODO', rank: 'a0' },
        to: { status: 'IN_PROGRESS', rank: dto.rank },
      },
    });
  });

  it('UC-MV02: cùng cột, C sau A ⇒ A, C, B; audit MOVED', async () => {
    const { h, t } = board();
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.C.id,
      input: { expectedVersion: 1, afterId: t.A.id },
    });
    expect(column(h, 'TODO')).toEqual([t.A.id, t.C.id, t.B.id]);
    expect(dto.version).toBe(2);
    expect(h.auditOf(t.C.id).map((a) => a.action)).toEqual(['MOVED']);
  });

  it('UC-MV03: A trước C ⇒ B, A, C', async () => {
    const { h, t } = board();
    await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.A.id,
      input: { expectedVersion: 1, beforeId: t.C.id },
    });
    expect(column(h, 'TODO')).toEqual([t.B.id, t.A.id, t.C.id]);
  });

  it('UC-MV04/MV05: không anchor ⇒ cuối cột đích; cột trống ⇒ between(null, null)', async () => {
    const { h, t } = board();
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.A.id,
      input: { expectedVersion: 1, status: 'IN_PROGRESS' },
    });
    expect(dto.rank > 'a6').toBe(true);
    const fresh = createTaskHarness();
    const x = fresh.seedTask({ rank: 'a0' });
    const moved = await fresh.move.execute({
      ...fresh.scope('Mia'),
      taskId: x.id,
      input: { expectedVersion: 1, status: 'IN_PROGRESS' },
    });
    expect(moved.rank).toBe('a0');
    expect(moved.version).toBe(2);
  });

  it('UC-MV06: C lên đầu (trước A) ⇒ rank < A', async () => {
    const { h, t } = board();
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.C.id,
      input: { expectedVersion: 1, beforeId: t.A.id },
    });
    expect(dto.rank < 'a0').toBe(true);
  });

  it('UC-MV07: client cũ (afterId A, beforeId B nhưng B đã dời) ⇒ dùng hàng xóm thực tế của A', async () => {
    const { h, t } = board();
    h.row(t.B.id).status = 'DONE';
    const x = h.seedTask({ rank: 'a9', status: 'IN_PROGRESS' });
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: x.id,
      input: { expectedVersion: 1, status: 'TODO', afterId: t.A.id, beforeId: t.B.id },
    });
    expect(dto.rank > 'a0' && dto.rank < 'a2').toBe(true);
  });

  it('UC-MV08..MV12: anchor sai ⇒ 422 INVALID_ANCHOR', async () => {
    const { h, t } = board();
    const f = h.seedTask({ rank: 'a0', projectId: P3 });
    h.row(t.B.id).deletedAt = new Date();
    for (const afterId of [t.D.id, t.A.id, f.id, t.B.id, h.randomId()]) {
      const err = await errorOf(
        h.move.execute({
          ...h.scope('Mia'),
          taskId: t.A.id,
          input: { expectedVersion: 1, afterId },
        }),
      );
      expect(err).toBeInstanceOf(BusinessRuleViolationError);
      expect((err as BusinessRuleViolationError).details).toMatchObject({ rule: 'INVALID_ANCHOR' });
    }
    expect(h.auditOf(t.A.id)).toHaveLength(0);
  });

  it('UC-MV13: TODO → DONE ⇒ 422 INVALID_STATUS_TRANSITION kèm allowed', async () => {
    const { h, t } = board();
    const err = await errorOf(
      h.move.execute({
        ...h.scope('Mia'),
        taskId: t.A.id,
        input: { expectedVersion: 1, status: 'DONE' },
      }),
    );
    expect(err).toBeInstanceOf(InvalidStatusTransitionError);
    expect((err as InvalidStatusTransitionError).details).toEqual({
      from: 'TODO',
      to: 'DONE',
      allowed: ['IN_PROGRESS'],
    });
  });

  it('UC-MV14: version cũ ⇒ 409 kèm currentVersion + TaskDto hiện tại; không audit, không event', async () => {
    const { h, t } = board();
    h.row(t.A.id).version = 2;
    const err = await errorOf(
      h.move.execute({
        ...h.scope('Mia'),
        taskId: t.A.id,
        input: { expectedVersion: 1, status: 'IN_PROGRESS' },
      }),
    );
    expect(err).toBeInstanceOf(VersionConflictError);
    expect((err as VersionConflictError).details).toMatchObject({
      currentVersion: 2,
      current: { id: t.A.id, key: 'TF-1', version: 2 },
    });
    expect(h.auditOf(t.A.id)).toHaveLength(0);
    expect(h.emitted()).toHaveLength(0);
  });

  it('UC-MV15: về đúng chỗ cũ ⇒ no-op 200, v1, không audit/event (R15)', async () => {
    const { h, t } = board();
    const cases = [
      [t.A.id, { afterId: null, beforeId: t.B.id }],
      [t.B.id, { afterId: t.A.id }],
      [t.B.id, { beforeId: t.C.id }],
      [t.C.id, {}],
    ] as const;
    for (const [taskId, anchors] of cases) {
      const dto = await h.move.execute({
        ...h.scope('Mia'),
        taskId,
        input: { expectedVersion: 1, ...anchors },
      });
      expect(dto.version).toBe(1);
    }
    expect(column(h, 'TODO')).toEqual([t.A.id, t.B.id, t.C.id]);
    expect(h.db.state.audit).toHaveLength(0);
    expect(h.emitted()).toHaveLength(0);
  });

  it('UC-MV16: no-op với version cũ vẫn 409 (ADR-091)', async () => {
    const { h, t } = board();
    h.row(t.A.id).version = 2;
    await expect(
      h.move.execute({
        ...h.scope('Mia'),
        taskId: t.A.id,
        input: { expectedVersion: 1, beforeId: t.B.id },
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('UC-MV17..MV19: archived ⇒ 422; VIEWER ⇒ 403 trước 422/409; archived trước 409', async () => {
    const h = createTaskHarness();
    const arc = h.seedTask({ rank: 'a0', projectId: P2 });
    const move = (who: 'Mia' | 'Vic', expectedVersion: number) =>
      h.move.execute({
        ...h.scope(who, P2),
        taskId: arc.id,
        input: { expectedVersion, status: 'IN_PROGRESS' },
      });
    await expect(move('Mia', 1)).rejects.toBeInstanceOf(ProjectArchivedError);
    await expect(move('Vic', 9)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(move('Mia', 9)).rejects.toBeInstanceOf(ProjectArchivedError);
  });

  it('UC-MV20/MV21: task của project khác trên URL / đã xóa mềm ⇒ 404', async () => {
    const { h, t } = board();
    const f = h.seedTask({ rank: 'a0', projectId: P3 });
    h.row(t.B.id).deletedAt = new Date();
    for (const taskId of [f.id, t.B.id]) {
      await expect(
        h.move.execute({
          ...h.scope('Mia'),
          taskId,
          input: { expectedVersion: 1, status: 'IN_PROGRESS' },
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    }
  });

  it('UC-MV22: MEMBER move task người khác tạo, gán cho người khác ⇒ được', async () => {
    const { h, t } = board();
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.E.id,
      input: { expectedVersion: 1, beforeId: t.D.id },
    });
    expect(dto.version).toBe(2);
  });

  it('ghi bị ghi khác chen giữa (save có điều kiện version trả false) ⇒ 409 với bản mới nhất', async () => {
    const { h, t } = board();
    const save = h.deps.tasks.save.bind(h.deps.tasks);
    h.deps.tasks.save = (task, expected) => {
      h.row(task.id).version = 5;
      return save(task, expected);
    };
    const err = await errorOf(
      h.move.execute({
        ...h.scope('Mia'),
        taskId: t.A.id,
        input: { expectedVersion: 1, status: 'IN_PROGRESS' },
      }),
    );
    expect((err as VersionConflictError).details).toMatchObject({ currentVersion: 5 });
    expect(h.auditOf(t.A.id)).toHaveLength(0);
  });
});
