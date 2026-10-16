import { describe, expect, it, vi } from 'vitest';

import {
  BusinessRuleViolationError,
  ForbiddenError,
  InvalidStatusTransitionError,
  ProjectArchivedError,
  ResourceNotFoundError,
  VersionConflictError,
} from '../../../../core/errors';
import { createTaskHarness, P2, P3, U } from '../../testing/task-harness';

// test-spec-task.md §3.2 (tầng A, rankGen thật). Bối cảnh: TODO [A a0, B a1, C a2], IN_PROGRESS [D a5, E a6].
// Spec ghi D "b0", E "b1" — không phải khóa fractional-indexing hợp lệ (đầu "b" cần 2 chữ số) nên đổi.
async function board() {
  const h = await createTaskHarness();
  const t = {
    A: await h.seedTask({ rank: 'a0' }),
    B: await h.seedTask({ rank: 'a1' }),
    C: await h.seedTask({ rank: 'a2' }),
    D: await h.seedTask({ rank: 'a5', status: 'IN_PROGRESS' }),
    E: await h.seedTask({
      rank: 'a6',
      status: 'IN_PROGRESS',
      createdById: U.Pam,
      assigneeId: U.Max,
    }),
  };
  return { h, t };
}

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

describe('MoveTaskUseCase', () => {
  it('UC-MV01: sang cột khác sau D ⇒ rank ∈ (D, E), v2, audit STATUS_CHANGED, realtime task:moved', async () => {
    const { h, t } = await board();
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.A.id,
      input: { expectedVersion: 1, status: 'IN_PROGRESS', afterId: t.D.id },
    });
    expect(dto).toMatchObject({ status: 'IN_PROGRESS', version: 2 });
    expect(dto.rank > 'a5' && dto.rank < 'a6').toBe(true);
    expect(await h.auditOf(t.A.id)).toEqual([
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
    const { h, t } = await board();
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.C.id,
      input: { expectedVersion: 1, afterId: t.A.id },
    });
    expect(await h.column('TODO')).toEqual([t.A.id, t.C.id, t.B.id]);
    expect(dto.version).toBe(2);
    expect((await h.auditOf(t.C.id)).map((a) => a.action)).toEqual(['MOVED']);
  });

  it('UC-MV03: A trước C ⇒ B, A, C', async () => {
    const { h, t } = await board();
    await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.A.id,
      input: { expectedVersion: 1, beforeId: t.C.id },
    });
    expect(await h.column('TODO')).toEqual([t.B.id, t.A.id, t.C.id]);
  });

  it('UC-MV04: không anchor ⇒ cuối cột đích (rank > E)', async () => {
    const { h, t } = await board();
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.A.id,
      input: { expectedVersion: 1, status: 'IN_PROGRESS' },
    });
    expect(dto.rank > 'a6').toBe(true);
  });

  it('UC-MV05: cột đích trống ⇒ rank = between(null, null)', async () => {
    const h = await createTaskHarness();
    const x = await h.seedTask({ rank: 'a0' });
    const moved = await h.move.execute({
      ...h.scope('Mia'),
      taskId: x.id,
      input: { expectedVersion: 1, status: 'IN_PROGRESS' },
    });
    expect(moved).toMatchObject({ rank: 'a0', version: 2 });
  });

  it('UC-MV06: C lên đầu (trước A) ⇒ rank < A', async () => {
    const { h, t } = await board();
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.C.id,
      input: { expectedVersion: 1, beforeId: t.A.id },
    });
    expect(dto.rank < 'a0').toBe(true);
  });

  it('UC-MV07: client cũ (afterId A, beforeId B nhưng B đã dời) ⇒ dùng hàng xóm thực tế của A', async () => {
    const { h, t } = await board();
    await h.patchTask(t.B.id, { status: 'DONE' });
    const x = await h.seedTask({ rank: 'a9', status: 'IN_PROGRESS' });
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: x.id,
      input: { expectedVersion: 1, status: 'TODO', afterId: t.A.id, beforeId: t.B.id },
    });
    expect(dto.rank > 'a0' && dto.rank < 'a2').toBe(true);
  });

  it('UC-MV08..MV12: anchor sai ⇒ 422 INVALID_ANCHOR', async () => {
    const { h, t } = await board();
    const f = await h.seedTask({ rank: 'a0', projectId: P3 });
    await h.patchTask(t.B.id, { deletedAt: new Date() });
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
    expect(await h.auditOf(t.A.id)).toHaveLength(0);
  });

  it('UC-MV13: TODO → DONE ⇒ 422 INVALID_STATUS_TRANSITION kèm allowed', async () => {
    const { h, t } = await board();
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
    const { h, t } = await board();
    await h.patchTask(t.A.id, { version: 2 });
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
    expect(await h.auditOf(t.A.id)).toHaveLength(0);
    expect(h.emitted()).toHaveLength(0);
  });

  it('UC-MV15: về đúng chỗ cũ ⇒ no-op 200, v1, không audit/event (R15)', async () => {
    const { h, t } = await board();
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
    expect(await h.column('TODO')).toEqual([t.A.id, t.B.id, t.C.id]);
    expect(await h.allAudit()).toHaveLength(0);
    expect(h.emitted()).toHaveLength(0);
  });

  it('UC-MV16: no-op với version cũ vẫn 409 (ADR-091)', async () => {
    const { h, t } = await board();
    await h.patchTask(t.A.id, { version: 2 });
    await expect(
      h.move.execute({
        ...h.scope('Mia'),
        taskId: t.A.id,
        input: { expectedVersion: 1, beforeId: t.B.id },
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('UC-MV17..MV19: archived ⇒ 422; VIEWER ⇒ 403 trước 422/409; archived trước 409', async () => {
    const h = await createTaskHarness();
    const arc = await h.seedTask({ rank: 'a0', projectId: P2 });
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
    const { h, t } = await board();
    const f = await h.seedTask({ rank: 'a0', projectId: P3 });
    await h.patchTask(t.B.id, { deletedAt: new Date() });
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
    const { h, t } = await board();
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.E.id,
      input: { expectedVersion: 1, beforeId: t.D.id },
    });
    expect(dto.version).toBe(2);
  });

  it('ghi bị ghi khác chen giữa (save có điều kiện version trả false) ⇒ 409 với bản mới nhất', async () => {
    const { h, t } = await board();
    const save = h.deps.tasks.save.bind(h.deps.tasks);
    h.deps.tasks.save = async (task, expected) => {
      await h.patchTask(task.id, { version: 5 });
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
    expect(await h.auditOf(t.A.id)).toHaveLength(0);
  });
});

// F3 (mutation, report §4.2) — biên của move mà mutant còn sống.
describe('MoveTaskUseCase — biên (F3 mutation)', () => {
  it('T-3: no-op R15 trên cột có KHE giữa các rank (không tính lại ra đúng rank cũ); đổi cột thì luôn tính rank mới', async () => {
    const h = await createTaskHarness();
    const a = await h.seedTask({ rank: 'a0' });
    const b = await h.seedTask({ rank: 'a3' });
    const c = await h.seedTask({ rank: 'a7' });
    const cases = [
      [b.id, { afterId: a.id }],
      [a.id, { beforeId: b.id }],
      [c.id, {}],
    ] as const;
    for (const [taskId, anchors] of cases) {
      const dto = await h.move.execute({
        ...h.scope('Mia'),
        taskId,
        input: { expectedVersion: 1, ...anchors },
      });
      expect(dto.version).toBe(1);
    }
    expect((await h.row(b.id)).rank).toBe('a3');
    expect(await h.auditOf(b.id)).toEqual([]);
    // X ở cột khác, rank 'a6' tình cờ nằm trong khe (B, C) — vẫn phải nhận rank mới của cột đích
    // (`between('a3','a7')` = 'a4', khác 'a6' ⇒ phân biệt được).
    const x = await h.seedTask({ rank: 'a6', status: 'IN_PROGRESS' });
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: x.id,
      input: { expectedVersion: 1, status: 'TODO', afterId: b.id },
    });
    expect(dto).toMatchObject({
      status: 'TODO',
      version: 2,
      rank: h.deps.ranks.between('a3', 'a7'),
    });
  });

  it('T-4: project bị archive trong lúc CHỜ khóa cột ⇒ 422 PROJECT_ARCHIVED (không phải 409)', async () => {
    const { h, t } = await board();
    const lock = h.deps.tasks.lockColumn.bind(h.deps.tasks);
    h.deps.tasks.lockColumn = async (projectId, status) => {
      await h.backend.patchProject(projectId, { archivedAt: new Date() });
      return lock(projectId, status);
    };
    await expect(
      h.move.execute({
        ...h.scope('Mia'),
        taskId: t.C.id,
        input: { expectedVersion: 1, afterId: t.A.id },
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'PROJECT_ARCHIVED' });
  });

  // Mỗi ca một harness: trên Postgres (runner LSP) DB chỉ được làm sạch ở beforeEach.
  it.each([
    [64, false],
    [65, true],
  ] as const)(
    'T-17: ngưỡng rebalance là "dài HƠN 64": rank %i ký tự ⇒ rebalance = %s',
    async (len, rebalanced) => {
      const { h, t } = await board();
      const long = `a0${'V'.repeat(len - 2)}`;
      h.deps.ranks.between = () => long;
      await h.move.execute({
        ...h.scope('Mia'),
        taskId: t.C.id,
        input: { expectedVersion: 1, afterId: t.A.id },
      });
      expect(h.logger.messages('info').includes('task.rank_rebalanced')).toBe(rebalanced);
    },
  );

  it('T-25: chuyển trạng thái sai được báo TRƯỚC anchor sai (TODO → DONE với afterId ở TODO ⇒ INVALID_STATUS_TRANSITION)', async () => {
    const { h, t } = await board();
    await expect(
      h.move.execute({
        ...h.scope('Mia'),
        taskId: t.C.id,
        input: { expectedVersion: 1, status: 'DONE', afterId: t.A.id },
      }),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });

  it('T-22/T-23/T-26: 403 mang quyền thiếu; 404 mang loại tài nguyên; no-op không ghi DB', async () => {
    const { h, t } = await board();
    await expect(
      h.move.execute({ ...h.scope('Vic'), taskId: t.C.id, input: { expectedVersion: 1 } }),
    ).rejects.toMatchObject({ statusCode: 403, details: { required: 'task:move' } });
    const f = await h.seedTask({ rank: 'a0', projectId: P3 });
    await expect(
      h.move.execute({ ...h.scope('Mia'), taskId: f.id, input: { expectedVersion: 1 } }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'task' } });
    const save = vi.spyOn(h.deps.tasks, 'save');
    await h.move.execute({ ...h.scope('Mia'), taskId: t.C.id, input: { expectedVersion: 1 } });
    expect(save).not.toHaveBeenCalled();
  });
});
