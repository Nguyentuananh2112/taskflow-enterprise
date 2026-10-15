import { describe, expect, it } from 'vitest';

import { createTaskHarness, U, type TaskHarness } from '../../testing/task-harness';
import { RANK_REBALANCE_THRESHOLD } from '../task-rank-rebalancer';

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
});
