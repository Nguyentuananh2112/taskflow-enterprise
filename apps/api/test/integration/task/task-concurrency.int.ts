// Tầng C của test-spec-task.md: N lệnh song song bằng Promise.all — mỗi `uow.run` một transaction
// trên connection riêng của pool. Lặp `TASK_CC_REPEAT` lần (mặc định 1 ở PR; nightly đặt 20).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { requestContext } from '../../../src/core/context/request-context';
import { VersionConflictError } from '../../../src/core/errors';
import {
  createTaskHarness,
  P1,
  P3,
  U,
  W1,
  type TaskHarness,
} from '../../../src/modules/task/testing/task-harness';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';
import { prismaTaskBackend } from './prisma-task-backend';

const REPEAT = Number(process.env.TASK_CC_REPEAT ?? '1');
const rounds = Array.from({ length: REPEAT }, (_, i) => i + 1);

let h: TaskHarness;
let backend: ReturnType<typeof prismaTaskBackend>;
beforeEach(async () => {
  await resetDatabase();
  backend = prismaTaskBackend();
  h = await createTaskHarness(backend);
});
afterAll(disconnectTestPrisma);

const settle = <T>(ps: Promise<T>[]) => Promise.allSettled(ps);
const fulfilled = <T>(rs: PromiseSettledResult<T>[]) =>
  rs.filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled').map((r) => r.value);
const rejected = <T>(rs: PromiseSettledResult<T>[]) =>
  rs
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason as unknown);
const people = ['Mia', 'Max', 'Pam'] as const;
const createMany = (n: number, projectId = P1) =>
  settle(
    Array.from({ length: n }, (_, i) =>
      h.create.execute({
        ...h.scope(people[i % 3]!, projectId),
        input: { title: `Song song ${i + 1}` },
      }),
    ),
  );
const liveNumbers = async (projectId: string) =>
  (
    await testPrisma().task.findMany({
      where: { projectId, deletedAt: null },
      select: { number: true },
    })
  )
    .map((t) => t.number)
    .sort((a, b) => a - b);
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe.each(rounds)('cấp số TF-n đồng thời — lượt %i', () => {
  it('CC-CR01 + CC-CR05: 50 create song song ⇒ đúng {1..50}, bộ đếm 51, rank cột TODO không trùng', async () => {
    const results = await createMany(50);
    expect(rejected(results)).toEqual([]);
    expect(await liveNumbers(P1)).toEqual(range(50));
    expect((await h.project(P1)).nextTaskNumber).toBe(51);
    const ranks = (await h.backend.taskRows()).map((t) => t.rank);
    expect(new Set(ranks).size).toBe(50);
  });

  it('CC-CR02: 20 create P1 song song 20 create P3 ⇒ mỗi project {1..20} (khóa theo dòng project)', async () => {
    const started = Date.now();
    const [a, b] = await Promise.all([createMany(20, P1), createMany(20, P3)]);
    expect([...rejected(a), ...rejected(b)]).toEqual([]);
    expect(await liveNumbers(P1)).toEqual(range(20));
    expect(await liveNumbers(P3)).toEqual(range(20));
    console.info(`CC-CR02: 40 create trên 2 project mất ${Date.now() - started} ms`);
  });

  it('CC-CR03: 10 create, lệnh thứ 5 rollback sau khi đã cấp số ⇒ 9 task, đúng 1 lỗ, không trùng', async () => {
    const append = h.deps.audit.append.bind(h.deps.audit);
    h.deps.audit.append = (e) =>
      (e.newValue as { title?: string } | null)?.title === 'Song song 5'
        ? Promise.reject(new Error('ép rollback'))
        : append(e);
    const results = await createMany(10);
    expect(fulfilled(results)).toHaveLength(9);
    const numbers = await liveNumbers(P1);
    expect(new Set(numbers).size).toBe(9);
    expect(range(10).filter((n) => !numbers.includes(n))).toHaveLength(1);
  });

  it('CC-CR04: 10 create song song với archive P1 ⇒ chỉ 201 hoặc 422, số liên tục từ 1, cuối cùng archived', async () => {
    const archive = (async () => {
      await new Promise((r) => setTimeout(r, 5));
      await testPrisma().project.update({ where: { id: P1 }, data: { archivedAt: new Date() } });
    })();
    const [results] = await Promise.all([createMany(10), archive]);
    for (const err of rejected(results)) expect(err).toMatchObject({ code: 'PROJECT_ARCHIVED' });
    const numbers = await liveNumbers(P1);
    expect(numbers).toEqual(range(numbers.length));
    expect((await h.project(P1)).archivedAt).not.toBeNull();
  });
});

describe.each(rounds)('move/update/delete đồng thời — lượt %i', () => {
  async function board() {
    return {
      a: await h.seedTask({ rank: 'a0' }),
      b: await h.seedTask({ rank: 'a1' }),
      x: await h.seedTask({ rank: 'a0', status: 'IN_PROGRESS' }),
      y: await h.seedTask({ rank: 'a1', status: 'IN_PROGRESS' }),
    };
  }
  const move = (taskId: string, input: Parameters<TaskHarness['move']['execute']>[0]['input']) =>
    requestContext.run({ requestId: `move-${taskId}` }, () =>
      h.move.execute({ ...h.scope('Mia'), taskId, input }),
    );

  it('CC-MV01/MV02: 10 move cùng task cùng expectedVersion ⇒ đúng 1 thắng, 9 lần 409 với current.version = 2', async () => {
    const { a, x, y } = await board();
    const targets = [
      { status: 'IN_PROGRESS' as const, afterId: x.id },
      { status: 'IN_PROGRESS' as const, beforeId: y.id },
    ];
    const results = await settle(
      Array.from({ length: 10 }, (_, i) => move(a.id, { expectedVersion: 1, ...targets[i % 2]! })),
    );
    expect(fulfilled(results)).toHaveLength(1);
    const errors = rejected(results);
    expect(errors).toHaveLength(9);
    for (const e of errors) {
      expect(e).toBeInstanceOf(VersionConflictError);
      expect((e as VersionConflictError).details).toMatchObject({
        currentVersion: 2,
        current: { version: 2 },
      });
    }
    expect(await h.auditOf(a.id)).toHaveLength(1);
  });

  it('CC-MV03: X và Y cùng thả vào TODO ngay sau A ⇒ cả hai thành công nhờ retry, không trùng rank', async () => {
    const { a, b, x, y } = await board();
    const results = await settle([
      move(x.id, { expectedVersion: 1, status: 'TODO', afterId: a.id }),
      move(y.id, { expectedVersion: 1, status: 'TODO', afterId: a.id }),
    ]);
    expect(rejected(results)).toEqual([]);
    const column = await h.column('TODO');
    expect(column[0]).toBe(a.id);
    expect(column.at(-1)).toBe(b.id);
    expect(new Set(column)).toEqual(new Set([a.id, b.id, x.id, y.id]));
    const ranks = (await h.backend.taskRows())
      .filter((t) => t.status === 'TODO')
      .map((t) => t.rank);
    expect(new Set(ranks).size).toBe(4);
  });

  it('CC-MV04: move ‖ update cùng task v1 ⇒ đúng 1 thắng, bên kia 409', async () => {
    const { a } = await board();
    const results = await settle([
      move(a.id, { expectedVersion: 1, status: 'IN_PROGRESS' }),
      h.update.execute({
        ...h.scope('Pam'),
        taskId: a.id,
        input: { expectedVersion: 1, title: 'Đổi tên song song' },
      }),
    ]);
    expect(fulfilled(results)).toHaveLength(1);
    expect(rejected(results)[0]).toBeInstanceOf(VersionConflictError);
    expect((await h.row(a.id)).version).toBe(2);
  });

  it('CC-AR01 (T-028 L1): 10 update khác task song song với archive P1 ⇒ chỉ 200 hoặc 422, không 500; sau archive không ghi được', async () => {
    const tasks = [];
    for (let i = 0; i < 10; i += 1) tasks.push(await h.seedTask({ rank: `a${i}` }));
    const archive = (async () => {
      await new Promise((r) => setTimeout(r, 5));
      await testPrisma().project.update({ where: { id: P1 }, data: { archivedAt: new Date() } });
    })();
    const [results] = await Promise.all([
      settle(
        tasks.map((t, i) =>
          h.update.execute({
            ...h.scope('Mia'),
            taskId: t.id,
            input: { expectedVersion: 1, title: `Đua ${i}` },
          }),
        ),
      ),
      archive,
    ]);
    for (const err of rejected(results)) expect(err).toMatchObject({ code: 'PROJECT_ARCHIVED' });
    const after = await settle([
      h.update.execute({
        ...h.scope('Mia'),
        taskId: tasks[0]!.id,
        input: { expectedVersion: 9, title: 'Muộn' },
      }),
    ]);
    expect(rejected(after)[0]).toMatchObject({ code: 'PROJECT_ARCHIVED' });
  });

  it('CC-DL01: delete ‖ update cùng task v1 ⇒ đúng 1 thắng, bên kia 409 hoặc 404, không 500', async () => {
    const { a } = await board();
    const results = await settle([
      h.remove.execute({ ...h.scope('Mia'), taskId: a.id, input: { expectedVersion: 1 } }),
      h.update.execute({
        ...h.scope('Pam'),
        taskId: a.id,
        input: { expectedVersion: 1, title: 'Sửa khi xóa' },
      }),
    ]);
    expect(fulfilled(results)).toHaveLength(1);
    expect([409, 404]).toContain((rejected(results)[0] as { statusCode?: number }).statusCode);
  });
});

describe.each(rounds)('rebalance rank đồng thời (T-033) — lượt %i', () => {
  it('CC-RB01: move kích hoạt rebalance ‖ 6 move khác vào cùng cột ⇒ không mất task, không mất thứ tự, không còn khóa tạm', async () => {
    const LONG = `a0${'V'.repeat(70)}`;
    const a = await h.seedTask({ rank: 'a0' });
    const b = await h.seedTask({ rank: LONG });
    const c = await h.seedTask({ rank: `${LONG}V` });
    const x = await h.seedTask({ rank: 'a0', status: 'IN_PROGRESS' });
    const others = [];
    for (let i = 1; i <= 6; i += 1)
      others.push(await h.seedTask({ rank: `a${i}`, status: 'IN_PROGRESS' }));
    const anchors = [{ afterId: a.id }, { beforeId: c.id }, {}];
    const mv = (taskId: string, input: object) =>
      h.move.execute({
        ...h.scope('Mia'),
        taskId,
        input: { expectedVersion: 1, status: 'TODO', ...input },
      });

    const results = await settle([
      mv(x.id, { afterId: b.id }), // rank giữa B và C > 64 ký tự ⇒ rebalance
      ...others.map((t, i) => mv(t.id, anchors[i % 3]!)),
    ]);
    expect(rejected(results)).toEqual([]);

    const todo = await h.column('TODO');
    expect(new Set(todo)).toEqual(new Set([a.id, b.id, c.id, x.id, ...others.map((t) => t.id)]));
    const rows = (await h.backend.taskRows()).filter((t) => t.status === 'TODO');
    expect(new Set(rows.map((r) => r.rank)).size).toBe(rows.length);
    for (const r of rows) expect(r.rank.startsWith('~')).toBe(false);
    // Thứ tự gốc A < B < X(ngay sau B) < C được giữ dù các move khác chen vào.
    const pos = (id: string) => todo.indexOf(id);
    expect(pos(a.id)).toBeLessThan(pos(b.id));
    expect(pos(b.id)).toBeLessThan(pos(c.id));
    expect(pos(x.id)).toBeGreaterThan(pos(b.id));
    expect(pos(x.id)).toBeLessThan(pos(c.id));
    expect(h.logger.messages('info')).toContain('task.rank_rebalanced');
  });
});

describe.each(rounds)('create ‖ rebalance cùng cột TODO (F3 T-2, ADR-116) — lượt %i', () => {
  // Thứ tự xen được ÉP tất định: rebalance dừng ngay sau pha stash (khóa tạm `~<id>` chưa commit) tới khi
  // create xong hoặc hết 500 ms. Có khóa cột ⇒ create bị chặn ở `lockColumn`, chỉ xong SAU move, không
  // ai phải thử lại, task mới ở cuối cột. Bỏ khóa (mutant `lockColumn(projectId, '')`) ⇒ create đọc rank
  // cũ, xong TRƯỚC move, rebalance đụng rank của nó ⇒ chạy lại cả transaction (`task.rank_conflict_retry`).
  it('CC-RB02: create chen giữa rebalance ⇒ chờ khóa cột, xong sau move, không retry, vào cuối cột, không `~`', async () => {
    const LONG = `a0${'V'.repeat(70)}`;
    const a = await h.seedTask({ rank: 'a0' });
    const b = await h.seedTask({ rank: LONG });
    const c = await h.seedTask({ rank: `${LONG}V` });
    const x = await h.seedTask({ rank: 'a0', status: 'IN_PROGRESS' });

    let atStash!: () => void;
    const stashed = new Promise<void>((resolve) => (atStash = resolve));
    let createDone!: () => void;
    const created = new Promise<void>((resolve) => (createDone = resolve));
    const saveRanks = h.deps.tasks.saveRanks.bind(h.deps.tasks);
    let first = true;
    h.deps.tasks.saveRanks = async (writes) => {
      if (first) {
        first = false;
        atStash();
        await Promise.race([created, new Promise((resolve) => setTimeout(resolve, 500))]);
      }
      return saveRanks(writes);
    };

    const done: string[] = [];
    const move = h.move
      .execute({
        ...h.scope('Mia'),
        taskId: x.id,
        input: { expectedVersion: 1, status: 'TODO', afterId: b.id },
      })
      .then((dto) => (done.push('move'), dto));
    await stashed;
    // Gọi từ ngữ cảnh của test (không phải bên trong transaction của move — AsyncLocalStorage).
    const create = h.create
      .execute({ ...h.scope('Pam'), input: { title: 'Chen giữa rebalance' } })
      .then((dto) => (done.push('create'), createDone(), dto));
    const [moved, task] = await Promise.all([move, create]);

    expect(done).toEqual(['move', 'create']);
    expect(h.logger.messages('warn')).not.toContain('task.rank_conflict_retry');
    expect(await h.column('TODO')).toEqual([a.id, b.id, moved.id, c.id, task.id]);
    const rows = (await h.backend.taskRows()).filter((t) => t.status === 'TODO');
    expect(new Set(rows.map((r) => r.rank)).size).toBe(rows.length);
    for (const r of rows) expect(r.rank.startsWith('~')).toBe(false);
  });
});

describe.each(rounds)('bỏ gán khi hạ quyền đồng thời — lượt %i', () => {
  /** Mô phỏng ChangeMemberRole của Workspace: khóa ghi dòng membership, hạ VIEWER, gọi cleaner — cùng 1 tx. */
  const demoteMax = () =>
    h.uow.run(async () => {
      const tx = backend.uow;
      await tx.db()
        .$queryRaw`SELECT id FROM workspace_members WHERE workspace_id = ${W1}::uuid AND user_id = ${U.Max}::uuid FOR UPDATE`;
      await tx.db().workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: W1, userId: U.Max } },
        data: { role: 'VIEWER' },
      });
      return h.cleaner.unassignAllForUser({ workspaceId: W1, userId: U.Max, actorId: U.Olivia });
    });

  it('CC-UN01: assign cho Max ‖ hạ Max xuống VIEWER ⇒ không bao giờ ra "VIEWER mà vẫn được gán"', async () => {
    const t = await h.seedTask({ rank: 'a0', createdById: U.Pam });
    const [assign] = await settle<unknown>([
      h.assign.execute({
        ...h.scope('Pam'),
        taskId: t.id,
        input: { expectedVersion: 1, assigneeId: U.Max },
      }),
      demoteMax(),
    ]);
    const role = await testPrisma().workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: W1, userId: U.Max } },
    });
    expect(role.role).toBe('VIEWER');
    expect((await h.row(t.id)).assigneeId).toBeNull();
    const actions = (await h.auditOf(t.id)).map((a) => a.action);
    // (a) assign thua: 422 ASSIGNEE_NOT_MEMBER, không audit; (b) assign thắng rồi bị bỏ gán: 2 audit.
    if (assign?.status === 'rejected') {
      expect(assign.reason).toMatchObject({ details: { rule: 'ASSIGNEE_NOT_MEMBER' } });
      expect(actions).toEqual([]);
    } else {
      expect(actions).toEqual(['ASSIGNEE_CHANGED', 'ASSIGNEE_CHANGED']);
    }
  });
});
