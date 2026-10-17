import { describe, expect, it } from 'vitest';

import { ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import { createTaskHarness, P1, P2, P3, Q1, U } from '../../testing/task-harness';
import { TaskPolicy } from '../task.policy';
import { TaskQueries } from './task.queries';

// test-spec-task.md §3.6/§3.7 — phần kiểm được ở tầng A (InMemory cùng luật lọc/sắp với SQL).
// Tầng I (Postgres, EXPLAIN, collation) để ticket Prisma repository.
async function board() {
  const h = await createTaskHarness();
  const t = {
    done: await h.seedTask({ rank: 'a0', status: 'DONE' }),
    todo2: await h.seedTask({ rank: 'a1' }),
    todo1: await h.seedTask({ rank: 'a0', assigneeId: U.Max }),
    ip: await h.seedTask({ rank: 'a0', status: 'IN_PROGRESS', assigneeId: U.Zed }),
    gone: await h.seedTask({ rank: 'a2', deletedAt: new Date() }),
    other: await h.seedTask({ rank: 'a0', projectId: P3 }),
  };
  return { h, t };
}

describe('TaskQueries.listTasks', () => {
  it('UC-LS01/LS06: sắp status → rank → id; bỏ task đã xóa và task project khác', async () => {
    const { h, t } = await board();
    const res = await h.queries.listTasks({ ...h.scope('Vic'), query: { limit: 200 } });
    expect(res.items.map((x) => x.id)).toEqual([t.todo1.id, t.todo2.id, t.ip.id, t.done.id]);
    expect(res.page).toEqual({ nextCursor: null, hasMore: false, limit: 200 });
  });

  it('UC-LS02/LS03: lọc status, assigneeId, "none"', async () => {
    const { h, t } = await board();
    const ids = async (query: Record<string, string>) =>
      (await h.queries.listTasks({ ...h.scope('Mia'), query: { limit: 200, ...query } })).items.map(
        (x) => x.id,
      );
    expect(await ids({ status: 'IN_PROGRESS' })).toEqual([t.ip.id]);
    expect(await ids({ assigneeId: U.Max })).toEqual([t.todo1.id]);
    expect(await ids({ assigneeId: 'none' })).toEqual([t.todo2.id, t.done.id]);
  });

  it('UC-LS04: phân trang theo cursor — không trùng, không sót; trang cuối nextCursor null', async () => {
    const h = await createTaskHarness();
    for (let i = 0; i < 45; i += 1)
      await h.seedTask({ rank: `a${'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk'[i]}` });
    const seen: string[] = [];
    let cursor: string | undefined;
    const sizes: number[] = [];
    do {
      const res = await h.queries.listTasks({
        ...h.scope('Mia'),
        query: { limit: 20, ...(cursor ? { cursor } : {}) },
      });
      sizes.push(res.items.length);
      seen.push(...res.items.map((x) => x.id));
      cursor = res.page.nextCursor ?? undefined;
      expect(res.page.hasMore).toBe(cursor !== undefined);
    } while (cursor);
    expect(sizes).toEqual([20, 20, 5]);
    expect(new Set(seen).size).toBe(45);
  });

  it('UC-LS07/LS10: project ws khác ⇒ 404; project archived vẫn đọc được', async () => {
    const h = await createTaskHarness();
    await h.seedTask({ rank: 'a0', projectId: P2 });
    await expect(
      h.queries.listTasks({ ...h.scope('Mia', Q1), query: { limit: 50 } }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(
      (await h.queries.listTasks({ ...h.scope('Vic', P2), query: { limit: 50 } })).items,
    ).toHaveLength(1);
  });

  it('UC-LS08: cursor giả hoặc cursor của audit-logs ⇒ 400 trên field cursor', async () => {
    const { h, t } = await board();
    await h.update.execute({
      ...h.scope('Mia'),
      taskId: t.todo1.id,
      input: { expectedVersion: 1, title: 'Đổi 1' },
    });
    await h.update.execute({
      ...h.scope('Mia'),
      taskId: t.todo1.id,
      input: { expectedVersion: 2, title: 'Đổi 2' },
    });
    const audit = await h.queries.listAuditLogs({
      ...h.scope('Mia'),
      taskId: t.todo1.id,
      query: { limit: 1 },
    });
    for (const cursor of ['khong-phai-cursor', audit.page.nextCursor!]) {
      const err = await h.queries
        .listTasks({ ...h.scope('Mia'), query: { limit: 50, cursor } })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).issues[0]?.path).toEqual(['cursor']);
    }
  });

  it('UC-LS11: phần tử là TaskDto đầy đủ; assignee đã ẩn danh hóa hiện tên "Người dùng đã xóa"', async () => {
    const { h, t } = await board();
    const res = await h.queries.listTasks({
      ...h.scope('Mia'),
      query: { limit: 200, status: 'IN_PROGRESS' },
    });
    expect(res.items[0]).toMatchObject({
      id: t.ip.id,
      key: `TF-${t.ip.number}`,
      version: 1,
      assignee: { id: U.Zed, fullName: 'Người dùng đã xóa' },
      createdBy: { id: U.Mia, fullName: 'Mia' },
    });
  });
});

describe('TaskQueries.getTask / listAuditLogs', () => {
  it('UC-LS13 + R16: task qua URL project khác / task đã xóa ⇒ 404', async () => {
    const { h, t } = await board();
    await expect(
      h.queries.getTask({ ...h.scope('Mia', P3), taskId: t.todo1.id }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      h.queries.getTask({ ...h.scope('Mia'), taskId: t.gone.id }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      h.queries.getTask({ ...h.scope('Vic'), taskId: t.todo1.id }),
    ).resolves.toMatchObject({ id: t.todo1.id });
  });

  it('UC-AU01/AU03/AU06: lịch sử mới nhất trước, gồm DELETED; VIEWER đọc được', async () => {
    const h = await createTaskHarness();
    const dto = await h.create.execute({ ...h.scope('Mia'), input: { title: 'Có lịch sử' } });
    h.clock.advance(1000);
    await h.update.execute({
      ...h.scope('Mia'),
      taskId: dto.id,
      input: { expectedVersion: 1, title: 'Đổi tên' },
    });
    h.clock.advance(1000);
    await h.move.execute({
      ...h.scope('Mia'),
      taskId: dto.id,
      input: { expectedVersion: 2, status: 'IN_PROGRESS' },
    });
    h.clock.advance(1000);
    await h.assign.execute({
      ...h.scope('Pam'),
      taskId: dto.id,
      input: { expectedVersion: 3, assigneeId: U.Max },
    });
    h.clock.advance(1000);
    await h.remove.execute({ ...h.scope('Pam'), taskId: dto.id, input: {} });
    const res = await h.queries.listAuditLogs({
      ...h.scope('Vic'),
      taskId: dto.id,
      query: { limit: 50 },
    });
    expect(res.items.map((a) => a.action)).toEqual([
      'DELETED',
      'ASSIGNEE_CHANGED',
      'STATUS_CHANGED',
      'UPDATED',
      'CREATED',
    ]);
    expect(res.items[0]).toMatchObject({ taskId: dto.id, actor: { id: U.Pam, fullName: 'Pam' } });
  });

  it('UC-AU02: nhiều dòng cùng createdAt — phân trang phá hòa bằng id, không trùng/sót', async () => {
    const h = await createTaskHarness();
    const dto = await h.create.execute({ ...h.scope('Mia'), input: { title: 'Nhiều audit' } });
    for (let v = 1; v <= 11; v += 1) {
      await h.update.execute({
        ...h.scope('Mia'),
        taskId: dto.id,
        input: { expectedVersion: v, title: `Tên số ${v}` },
      });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await h.queries.listAuditLogs({
        ...h.scope('Mia'),
        taskId: dto.id,
        query: { limit: 5, ...(cursor ? { cursor } : {}) },
      });
      seen.push(...res.items.map((a) => a.id));
      cursor = res.page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('UC-AU05: task thuộc P3 qua URL P1 ⇒ 404', async () => {
    const { h, t } = await board();
    await expect(
      h.queries.listAuditLogs({ ...h.scope('Mia', P1), taskId: t.other.id, query: { limit: 5 } }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});

describe('phạm vi & validate đầu vào của truy vấn (T-028 L3/L4)', () => {
  const cursorOf = (kind: string, v: Record<string, unknown>) =>
    Buffer.from(JSON.stringify({ k: kind, v }), 'utf8').toString('base64url');

  it('perf/task-read-raw: phân trang từng task qua ranh giới status (không lọc) ⇒ đúng thứ tự status → rank → id, không trùng/sót', async () => {
    const { h, t } = await board();
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await h.queries.listTasks({
        ...h.scope('Mia'),
        query: { limit: 1, ...(cursor ? { cursor } : {}) },
      });
      seen.push(...res.items.map((x) => x.id));
      cursor = res.page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([t.todo1.id, t.todo2.id, t.ip.id, t.done.id]);
  });

  it('perf/task-read-raw: lọc status + cursor của status KHÁC (client tự chế) ⇒ giữ ngữ nghĩa so sánh bộ (status trước ⇒ cả cột, status sau ⇒ rỗng)', async () => {
    const { h, t } = await board();
    const list = (status: string, key: Record<string, unknown>) =>
      h.queries.listTasks({
        ...h.scope('Mia'),
        query: { limit: 50, status, cursor: cursorOf('tasks', key) } as never,
      });
    const ids = async (p: ReturnType<typeof list>) => (await p).items.map((x) => x.id);
    expect(await ids(list('IN_PROGRESS', { status: 'TODO', rank: 'zz', id: P1 }))).toEqual([
      t.ip.id,
    ]);
    expect(await ids(list('IN_PROGRESS', { status: 'DONE', rank: 'a0', id: P1 }))).toEqual([]);
    expect(await ids(list('TODO', { status: 'TODO', rank: 'a0', id: t.todo1.id }))).toEqual([
      t.todo2.id,
    ]);
  });

  it('L4: cursor đúng định dạng nhưng id không phải uuid / rank quá dài ⇒ 400 trên field cursor (không 500)', async () => {
    const h = await createTaskHarness();
    const bad = [
      cursorOf('tasks', { status: 'TODO', rank: 'a0', id: 'x' }),
      cursorOf('tasks', { status: 'TODO', rank: 'a'.repeat(1025), id: P1 }),
    ];
    for (const cursor of bad) {
      const err = await h.queries
        .listTasks({ ...h.scope('Mia'), query: { limit: 50, cursor } })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
    }
    const t = await h.seedTask({ rank: 'a0' });
    const auditCursor = cursorOf('task-audit-logs', {
      createdAt: '2026-10-15T08:00:00.000Z',
      id: 'x',
    });
    await expect(
      h.queries.listAuditLogs({
        ...h.scope('Mia'),
        taskId: t.id,
        query: { limit: 5, cursor: auditCursor },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('L3: đọc lịch sử có phạm vi tenant ngay trong truy vấn (project khác ⇒ rỗng)', async () => {
    const h = await createTaskHarness();
    const dto = await h.create.execute({ ...h.scope('Mia'), input: { title: 'Có lịch sử' } });
    expect(
      await h.backend.readModel.listAuditLogs(dto.workspaceId, P1, dto.id, null, 10),
    ).toHaveLength(1);
    expect(await h.backend.readModel.listAuditLogs(dto.workspaceId, P3, dto.id, null, 10)).toEqual(
      [],
    );
  });
});

// F3 (mutation, report §4.2): trang đúng bằng limit (T-12), RBAC lớp 2 của đọc (T-13), loại tài nguyên
// trong 404 (T-23).
describe('TaskQueries — biên (F3 mutation)', () => {
  it('T-12: đúng `limit` phần tử ⇒ trang cuối (hasMore false, nextCursor null) — cả task lẫn audit-logs', async () => {
    const h = await createTaskHarness();
    for (const r of ['a0', 'a1', 'a2', 'a3', 'a4']) await h.seedTask({ rank: r });
    const res = await h.queries.listTasks({ ...h.scope('Mia'), query: { limit: 5 } });
    expect(res.items).toHaveLength(5);
    expect(res.page).toEqual({ nextCursor: null, hasMore: false, limit: 5 });

    const t = await h.create.execute({ ...h.scope('Mia'), input: { title: 'Có lịch sử' } });
    for (const title of ['Lần 1', 'Lần 2']) {
      const cur = await h.queries.getTask({ ...h.scope('Mia'), taskId: t.id });
      await h.update.execute({
        ...h.scope('Mia'),
        taskId: t.id,
        input: { expectedVersion: cur.version, title },
      });
    }
    const audit = await h.queries.listAuditLogs({
      ...h.scope('Mia'),
      taskId: t.id,
      query: { limit: 3 },
    });
    expect(audit.items).toHaveLength(3);
    expect(audit.page).toEqual({ nextCursor: null, hasMore: false, limit: 3 });
  });

  it('T-13: policy từ chối ⇒ cả 3 đường đọc đều 403 với đúng quyền thiếu (lớp 2 — GET /:taskId không có cổng ở route)', async () => {
    const h = await createTaskHarness();
    const t = await h.seedTask({ rank: 'a0' });
    const queries = new TaskQueries({
      readModel: h.backend.readModel,
      projects: h.backend.projects,
      policy: new TaskPolicy({ allows: () => false }),
    });
    const scope = h.scope('Olivia');
    await expect(queries.getTask({ ...scope, taskId: t.id })).rejects.toMatchObject({
      statusCode: 403,
      details: { required: 'task:read' },
    });
    await expect(queries.listTasks({ ...scope, query: { limit: 5 } })).rejects.toMatchObject({
      statusCode: 403,
      details: { required: 'task:read' },
    });
    await expect(
      queries.listAuditLogs({ ...scope, taskId: t.id, query: { limit: 5 } }),
    ).rejects.toMatchObject({ statusCode: 403, details: { required: 'audit:read' } });
  });

  it('T-23: 404 mang loại tài nguyên đúng (project ws khác ⇒ project; task không có ⇒ task)', async () => {
    const h = await createTaskHarness();
    await expect(
      h.queries.listTasks({ ...h.scope('Mia', Q1), query: { limit: 5 } }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'project' } });
    await expect(
      h.queries.getTask({ ...h.scope('Mia'), taskId: h.randomId() }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'task' } });
    await expect(
      h.queries.listAuditLogs({ ...h.scope('Mia'), taskId: h.randomId(), query: { limit: 5 } }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'task' } });
  });
});
