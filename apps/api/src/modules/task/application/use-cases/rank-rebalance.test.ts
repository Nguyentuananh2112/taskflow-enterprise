import { describe, expect, it, vi } from 'vitest';

import { Rank } from '../../domain/rank';
import { requestContext } from '../../../../core/context/request-context';
import { createTaskHarness, P1, U, W1, type TaskHarness } from '../../testing/task-harness';
import { RankConflictError } from '../ports/task-repository.port';
import {
  RANK_REBALANCE_MAX_TASKS,
  RANK_REBALANCE_THRESHOLD,
  TaskRankRebalancer,
} from '../task-rank-rebalancer';

// T-033: cân bằng lại rank theo cột khi move sinh rank quá dài (ADR-011 mở rộng). Chạy trên cả
// InMemory và Postgres (runner LSP).
const LONG = `a0${'V'.repeat(RANK_REBALANCE_THRESHOLD + 6)}`; // khóa fractional-indexing hợp lệ, dài

async function crowdedColumn(h: TaskHarness) {
  return {
    a: await h.seedTask({ rank: 'a0' }),
    b: await h.seedTask({ rank: LONG }),
    // C sát ngay sau B ⇒ khóa giữa B và C buộc phải dài hơn ngưỡng (chèn vào khe hẹp).
    c: await h.seedTask({ rank: `${LONG}V`, createdById: U.Pam }),
    x: await h.seedTask({ rank: 'a0', status: 'IN_PROGRESS' }),
  };
}

const moveXAfterB = (h: TaskHarness, t: Awaited<ReturnType<typeof crowdedColumn>>) =>
  h.move.execute({
    ...h.scope('Mia', undefined, { clientId: '0199e5a2-0000-7000-8000-00000000c0de' }),
    taskId: t.x.id,
    input: { expectedVersion: 1, status: 'TODO', afterId: t.b.id },
  });

describe('rebalance rank theo cột (T-033)', () => {
  it('move sinh rank > ngưỡng ⇒ cả cột nhận rank ngắn mới, giữ đúng thứ tự A, B, X, C', async () => {
    const h = await createTaskHarness();
    const t = await crowdedColumn(h);
    const dto = await moveXAfterB(h, t);
    expect(await h.column('TODO')).toEqual([t.a.id, t.b.id, t.x.id, t.c.id]);
    const rows = await h.backend.taskRows();
    for (const r of rows) {
      expect(r.rank.length).toBeLessThanOrEqual(3);
      expect(r.rank.startsWith('~')).toBe(false);
    }
    expect(dto).toMatchObject({ status: 'TODO', version: 2 });
    expect(dto.rank.length).toBeLessThanOrEqual(3);
  });

  it('task bị đổi rank: version + 1, đúng 1 audit MOVED (actor = người move), 1 realtime task:moved; khóa trùng rank cũ ⇒ không đổi gì', async () => {
    const h = await createTaskHarness();
    const t = await crowdedColumn(h);
    await moveXAfterB(h, t);
    // A nhận lại đúng "a0" (khóa đầu của spread) ⇒ thứ tự không đổi, không version/audit/event.
    expect(await h.row(t.a.id)).toMatchObject({ rank: 'a0', version: 1 });
    expect(await h.auditOf(t.a.id)).toEqual([]);
    for (const other of [t.b, t.c]) {
      const row = await h.row(other.id);
      expect(row.version).toBe(2);
      expect(await h.auditOf(other.id)).toEqual([
        expect.objectContaining({
          action: 'MOVED',
          actorId: U.Mia,
          oldValue: { rank: other.rank },
          newValue: { rank: row.rank },
        }),
      ]);
    }
    expect((await h.auditOf(t.x.id)).map((a) => a.action)).toEqual(['STATUS_CHANGED']);
    const events = h
      .emitted()
      .map((c) => c.args[0] as { type: string; data: { task: { id: string } } });
    expect(events.map((e) => e.type)).toEqual(['task:moved', 'task:moved', 'task:moved']);
    expect(new Set(events.map((e) => e.data.task.id))).toEqual(new Set([t.b.id, t.c.id, t.x.id]));
    for (const c of h.emitted()) expect(c.duringTransaction).toBe(false);
    expect(h.logger.entries.find((e) => e.msg === 'task.rank_rebalanced')?.data).toMatchObject({
      status: 'TODO',
      tasks: 4,
    });
  });

  it('F1 (HIGH, review B): move CÙNG cột kích hoạt rebalance, khóa mới của task được move TRÙNG rank cũ ⇒ không còn rank tạm "~", tạo / thêm cuối cột vẫn chạy', async () => {
    const h = await createTaskHarness();
    const a = await h.seedTask({ rank: 'a0' });
    const b = await h.seedTask({ rank: LONG });
    const c = await h.seedTask({ rank: `${LONG}V`, createdById: U.Pam });
    // X đang cuối cột với rank "a2" — sau rebalance thứ tự A, B, X, C ⇒ X nhận đúng khóa "a2" của
    // spread (trùng rank cũ) ⇒ `moveTo` trả false.
    const x = await h.seedTask({ rank: 'a2' });
    await h.move.execute({
      ...h.scope('Mia'),
      taskId: x.id,
      input: { expectedVersion: 1, afterId: b.id },
    });
    const rows = await h.backend.taskRows();
    expect(rows.filter((r) => r.rank.startsWith('~')).map((r) => r.id)).toEqual([]);
    expect(await h.column('TODO')).toEqual([a.id, b.id, x.id, c.id]);
    // Trước khi sửa: rank "~<uuid>" còn lại ⇒ tính khóa cuối cột ném lỗi ⇒ 500 cho mọi create.
    const created = await h.create.execute({
      ...h.scope('Mia'),
      input: { title: 'Sau rebalance' },
    });
    expect((await h.column('TODO')).at(-1)).toBe(created.id);
  });

  it('F2 (review B): cột vượt RANK_REBALANCE_MAX_TASKS ⇒ KHÔNG rebalance (giữ khóa dài hợp lệ), log cảnh báo', async () => {
    const h = await createTaskHarness();
    const filler = RANK_REBALANCE_MAX_TASKS - 3; // + A, B, C ⇒ đủ MAX task khác, + X ⇒ vượt
    // Một lệnh chèn lô: seed từng task (~1500 lượt đi về DB) từng vượt timeout 30 s khi máy bận (A3).
    await h.seedTasks(
      Array.from({ length: filler }, (_, i) => ({
        rank: `a${'V'.repeat(RANK_REBALANCE_THRESHOLD + 8)}${i}`,
      })),
    );
    const t = await crowdedColumn(h);
    const dto = await moveXAfterB(h, t);
    expect(dto.rank.length).toBeGreaterThan(RANK_REBALANCE_THRESHOLD);
    expect(await h.row(t.a.id)).toMatchObject({ rank: 'a0', version: 1 });
    const rows = await h.backend.taskRows();
    expect(rows.some((r) => r.rank.startsWith('~'))).toBe(false);
    expect(h.logger.messages('warn')).toContain('task.rank_rebalance_skipped_large_column');
  });

  it('F3/F5 (review B): lỗi DB tạm thời (55P03 hết lock_timeout) ⇒ chạy lại transaction và thành công', async () => {
    const h = await createTaskHarness();
    const transient = Object.assign(new Error('lock timeout'), {
      meta: { driverAdapterError: { cause: { originalCode: '55P03' } } },
    });
    const run = h.backend.uow.run.bind(h.backend.uow);
    vi.spyOn(h.backend.uow, 'run')
      .mockImplementationOnce(() => Promise.reject(transient))
      .mockImplementation(run);
    const dto = await h.create.execute({ ...h.scope('Mia'), input: { title: 'Sau khi chờ khóa' } });
    expect(dto.title).toBe('Sau khi chờ khóa');
    expect(h.logger.messages('warn')).toContain('task.rank_conflict_retry');
  });

  it('F3/F5: lỗi tạm thời lặp lại quá giới hạn thử ⇒ 503 SERVICE_UNAVAILABLE (thử lại sau), không 500', async () => {
    const h = await createTaskHarness();
    const deadlock = Object.assign(new Error('deadlock'), { code: '40P01' });
    vi.spyOn(h.backend.uow, 'run').mockImplementation(() => Promise.reject(deadlock));
    await expect(
      h.create.execute({ ...h.scope('Mia'), input: { title: 'Không bao giờ' } }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'SERVICE_UNAVAILABLE' });
  });

  it('rank bình thường ⇒ không rebalance (chỉ task được move đổi)', async () => {
    const h = await createTaskHarness();
    const a = await h.seedTask({ rank: 'a0' });
    const c = await h.seedTask({ rank: 'a1' });
    const x = await h.seedTask({ rank: 'a0', status: 'IN_PROGRESS' });
    await h.move.execute({
      ...h.scope('Mia'),
      taskId: x.id,
      input: { expectedVersion: 1, status: 'TODO', afterId: a.id },
    });
    expect((await h.row(a.id)).version).toBe(1);
    expect((await h.row(c.id)).version).toBe(1);
    expect(h.logger.messages('info')).not.toContain('task.rank_rebalanced');
  });

  it('task trong cột bị sửa song song giữa chừng (version lệch) ⇒ thử lại cả transaction rồi thành công', async () => {
    const h = await createTaskHarness();
    const t = await crowdedColumn(h);
    // Khe thật duy nhất: một lệnh sửa C commit giữa lúc rebalance đọc cột và lúc khóa dòng (pha 1).
    // (Sau pha 1 dòng C đã bị khóa ⇒ lệnh sửa song song chỉ chờ rồi nhận 409 — không cần retry.)
    const stash = h.deps.tasks.stashColumnRanks.bind(h.deps.tasks);
    let injected = false;
    h.deps.tasks.stashColumnRanks = async (projectId, status) => {
      if (!injected) {
        injected = true;
        await h.patchTask(t.c.id, { version: 7, title: 'Sửa song song' });
      }
      return stash(projectId, status);
    };
    await expect(moveXAfterB(h, t)).resolves.toMatchObject({ status: 'TODO' });
    expect(h.logger.messages('warn')).toContain('task.rank_conflict_retry');
    expect(await h.column('TODO')).toEqual([t.a.id, t.b.id, t.x.id, t.c.id]);
    // (Ghi chen trên Postgres commit riêng; trên InMemory nó nằm trong snapshot nên bị rollback
    // cùng lượt thử đầu — chỉ khẳng định phần đúng cho cả hai backend.)
    for (const r of await h.backend.taskRows()) expect(r.rank.startsWith('~')).toBe(false);
  });

  // A3: pha 2 ghi theo LÔ — một `saveRanks` chứa MỌI dòng đã stash (kể cả dòng khóa trùng rank cũ),
  // một `appendMany` chỉ cho task thật sự đổi rank.
  it('A3: một lệnh ghi lô cho mọi dòng đã stash, một lệnh audit lô chỉ cho task đổi rank', async () => {
    const h = await createTaskHarness();
    const t = await crowdedColumn(h);
    const saveRanks = vi.spyOn(h.deps.tasks, 'saveRanks');
    const appendMany = vi.spyOn(h.deps.audit, 'appendMany');
    await moveXAfterB(h, t);
    expect(saveRanks).toHaveBeenCalledTimes(1);
    const writes = saveRanks.mock.calls[0]![0];
    expect(new Set(writes.map((w) => w.task.id))).toEqual(new Set([t.a.id, t.b.id, t.c.id]));
    // A: khóa trùng rank cũ ⇒ ghi lại với version cũ, KHÔNG bump.
    const a = writes.find((w) => w.task.id === t.a.id)!;
    expect([a.expectedVersion, a.task.version]).toEqual([1, 1]);
    for (const w of writes.filter((w) => w.task.id !== t.a.id)) {
      expect(w.task.version).toBe(w.expectedVersion + 1);
    }
    expect(appendMany).toHaveBeenCalledTimes(1);
    expect(appendMany.mock.calls[0]![0].map((e) => e.taskId).sort()).toEqual(
      [t.b.id, t.c.id].sort(),
    );
  });

  it('A3: `saveRanks` trùng rank với task sống khác ⇒ RankConflictError (cả câu SQL thô, không 500)', async () => {
    const h = await createTaskHarness();
    await h.seedTask({ rank: 'a0' });
    const b = await h.seedTask({ rank: 'a1' });
    const task = (await h.deps.tasks.findLive(b.workspaceId, b.projectId, b.id))!;
    task.moveTo('TODO', Rank.of('a0'), U.Mia, new Date());
    await expect(h.deps.tasks.saveRanks([{ task, expectedVersion: 1 }])).rejects.toBeInstanceOf(
      RankConflictError,
    );
  });

  it('A3: project bị archive song song giữa lúc rebalance ⇒ 422 PROJECT_ARCHIVED, không còn rank tạm "~"', async () => {
    const h = await createTaskHarness();
    const t = await crowdedColumn(h);
    const stash = h.deps.tasks.stashColumnRanks.bind(h.deps.tasks);
    h.deps.tasks.stashColumnRanks = async (projectId, status) => {
      await h.backend.patchProject(projectId, { archivedAt: new Date() });
      return stash(projectId, status);
    };
    await expect(moveXAfterB(h, t)).rejects.toMatchObject({
      statusCode: 422,
      code: 'PROJECT_ARCHIVED',
    });
    for (const r of await h.backend.taskRows()) expect(r.rank.startsWith('~')).toBe(false);
    expect(h.emitted()).toEqual([]);
  });

  it('A3: task trong cột bị xóa song song giữa lúc rebalance ⇒ thử lại cả transaction (không 404 cho người move)', async () => {
    const h = await createTaskHarness();
    const t = await crowdedColumn(h);
    const stash = h.deps.tasks.stashColumnRanks.bind(h.deps.tasks);
    let injected = false;
    h.deps.tasks.stashColumnRanks = async (projectId, status) => {
      if (!injected) {
        injected = true;
        await h.patchTask(t.c.id, { version: 2, deletedAt: new Date() });
      }
      return stash(projectId, status);
    };
    await expect(moveXAfterB(h, t)).resolves.toMatchObject({ status: 'TODO' });
    expect(h.logger.messages('warn')).toContain('task.rank_conflict_retry');
    for (const r of await h.backend.taskRows()) expect(r.rank.startsWith('~')).toBe(false);
  });
});

// F3 (mutation, report §4.2) — các biên của rebalance mà mutant còn sống.
describe('rebalance — biên (F3 mutation)', () => {
  it('T-1: chèn ở CHỈ SỐ 1 (sau phần tử đầu) ⇒ đúng chỗ [A, X, B], không bị đẩy xuống cuối cột', async () => {
    const h = await createTaskHarness();
    const a = await h.seedTask({ rank: LONG });
    const b = await h.seedTask({ rank: `${LONG}V` });
    const x = await h.seedTask({ rank: 'a0', status: 'IN_PROGRESS' });
    await h.move.execute({
      ...h.scope('Mia'),
      taskId: x.id,
      input: { expectedVersion: 1, status: 'TODO', afterId: a.id },
    });
    expect(await h.column('TODO')).toEqual([a.id, x.id, b.id]);
    for (const r of await h.backend.taskRows()) expect(r.rank.length).toBeLessThanOrEqual(3);
  });

  // T-5 — mỗi ca một harness (Postgres/LSP: DB chỉ làm sạch ở beforeEach).
  it('T-5a: CÙNG cột, khóa mới ≠ rank cũ ⇒ `moving` KHÔNG vào lô ghi (use case tự lưu)', async () => {
    // X cuối cột rank 'a9', move sau B ⇒ khóa spread 'a2'.
    const h = await createTaskHarness();
    const t = {
      a: await h.seedTask({ rank: 'a0' }),
      b: await h.seedTask({ rank: LONG }),
      c: await h.seedTask({ rank: `${LONG}V` }),
      x: await h.seedTask({ rank: 'a9' }),
    };
    const saveRanks = vi.spyOn(h.deps.tasks, 'saveRanks');
    await h.move.execute({
      ...h.scope('Mia'),
      taskId: t.x.id,
      input: { expectedVersion: 1, afterId: t.b.id },
    });
    expect(saveRanks.mock.calls[0]![0].map((w) => w.task.id)).not.toContain(t.x.id);
    expect(await h.column('TODO')).toEqual([t.a.id, t.b.id, t.x.id, t.c.id]);
  });

  it('T-5b: KHÁC cột, khóa mới TRÙNG rank cũ ⇒ `moving` KHÔNG vào lô ghi (use case lưu cả status)', async () => {
    // X ở IN_PROGRESS rank 'a2' vào TODO sau B ⇒ khóa spread 'a2'.
    const h = await createTaskHarness();
    const u = {
      a: await h.seedTask({ rank: 'a0' }),
      b: await h.seedTask({ rank: LONG }),
      c: await h.seedTask({ rank: `${LONG}V` }),
      x: await h.seedTask({ rank: 'a2', status: 'IN_PROGRESS' }),
    };
    const saveRanks = vi.spyOn(h.deps.tasks, 'saveRanks');
    const dto = await h.move.execute({
      ...h.scope('Mia'),
      taskId: u.x.id,
      input: { expectedVersion: 1, status: 'TODO', afterId: u.b.id },
    });
    expect(saveRanks.mock.calls[0]![0].map((w) => w.task.id)).not.toContain(u.x.id);
    expect(dto).toMatchObject({ status: 'TODO', rank: 'a2', version: 2 });
  });

  it('T-6: tổng ĐÚNG RANK_REBALANCE_MAX_TASKS task ⇒ VẪN rebalance (ngưỡng là "lớn hơn"), không cảnh báo bỏ qua', async () => {
    const h = await createTaskHarness();
    // filler + A, B, C + X = MAX
    await h.seedTasks(
      Array.from({ length: RANK_REBALANCE_MAX_TASKS - 4 }, (_, i) => ({
        rank: `a${'V'.repeat(RANK_REBALANCE_THRESHOLD + 8)}${i}`,
      })),
    );
    const t = await crowdedColumn(h);
    await moveXAfterB(h, t);
    expect(h.logger.messages('info')).toContain('task.rank_rebalanced');
    expect(h.logger.messages('warn')).not.toContain('task.rank_rebalance_skipped_large_column');
  });

  it('T-7/T-8: domain event của MỌI task đổi rank được publish; DTO realtime có createdBy/assignee thật, findRefs không nhận null', async () => {
    const h = await createTaskHarness();
    const t = await crowdedColumn(h);
    const findRefs = vi.spyOn(h.deps.users, 'findRefs');
    await moveXAfterB(h, t);
    const published = h.events.published.map((e) => [e.type, e.aggregateId]);
    expect(published).toEqual(
      expect.arrayContaining([
        ['TaskMoved', t.b.id],
        ['TaskMoved', t.c.id],
        ['TaskStatusChanged', t.x.id],
      ]),
    );
    expect(published).toHaveLength(3);
    for (const [ids] of findRefs.mock.calls) expect(ids).not.toContain(null);
    const cMoved = h
      .emitted()
      .map((c) => c.args[0] as { data: { task: { id: string; createdBy: unknown } } })
      .find((e) => e.data.task.id === t.c.id);
    expect(cMoved?.data.task.createdBy).toEqual(expect.objectContaining({ id: U.Pam }));
  });

  it('T-18: `wanted` lớn hơn mọi rank của cột ⇒ `moving` nhận khóa CUỐI', async () => {
    const h = await createTaskHarness();
    const a = await h.seedTask({ rank: 'a0' });
    const b = await h.seedTask({ rank: LONG });
    const x = await h.seedTask({ rank: 'a0', status: 'IN_PROGRESS' });
    const rank = await h.uow.run(async () => {
      const project = (await h.deps.projects.findInWorkspace({ workspaceId: W1, projectId: P1 }))!;
      const moving = (await h.deps.tasks.findLive(W1, P1, x.id))!;
      return new TaskRankRebalancer(h.commands).rebalance({
        project,
        target: 'TODO',
        moving,
        wanted: `z${'z'.repeat(RANK_REBALANCE_THRESHOLD)}`,
        meta: { actorId: U.Mia, originClientId: null },
      });
    });
    const keys = [(await h.row(a.id)).rank, (await h.row(b.id)).rank];
    expect(keys.every((k) => k < rank)).toBe(true);
  });

  it('T-19: audit MOVED của các task bị đổi rank mang requestId của request', async () => {
    const h = await createTaskHarness();
    const t = await crowdedColumn(h);
    await requestContext.run({ requestId: 'req-7' }, () => moveXAfterB(h, t));
    for (const other of [t.b, t.c]) {
      expect(await h.auditOf(other.id)).toEqual([
        expect.objectContaining({ action: 'MOVED', requestId: 'req-7' }),
      ]);
    }
  });
});
