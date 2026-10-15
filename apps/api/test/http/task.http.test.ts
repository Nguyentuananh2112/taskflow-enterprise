// Route /api/v1/workspaces/:wsId/projects/:projectId/tasks (data-and-api §2.7) trên composition root thật.
import { TASK_STATUS_TRANSITIONS } from '@taskflow/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

interface Task {
  id: string;
  key: string;
  status: string;
  version: number;
  rank: string;
  assignee: { id: string } | null;
  createdBy: { id: string } | null;
}

let t: TestApp;
let alice: TestUser; // OWNER ws A
let mia: TestUser; // MEMBER ws A
let vic: TestUser; // VIEWER ws A
let bob: TestUser; // OWNER ws B (người ngoài)
let projectId: string;

const base = (u: TestUser, pid = projectId, ws = u.workspaceId) =>
  `/api/v1/workspaces/${ws}/projects/${pid}/tasks`;
const inA = (pid = projectId) => `/api/v1/workspaces/${alice.workspaceId}/projects/${pid}/tasks`;

async function firstProject(u: TestUser): Promise<string> {
  const res = await request(t.app).get(`/api/v1/workspaces/${u.workspaceId}/projects`).set(u.auth);
  return envelopeOf<{ id: string }[]>(res).data?.[0]?.id ?? '';
}

async function join(u: TestUser, role: string) {
  await request(t.app)
    .post(`/api/v1/workspaces/${alice.workspaceId}/members`)
    .set(alice.auth)
    .send({ email: u.email, role });
}

async function createTask(u: TestUser, body: object = { title: 'Viết test' }) {
  const res = await request(t.app).post(inA()).set(u.auth).send(body);
  return { res, task: envelopeOf<Task>(res).data as Task };
}

beforeEach(async () => {
  t = createTestApp();
  alice = await t.register('Alice');
  mia = await t.register('Mia');
  vic = await t.register('Vic');
  bob = await t.register('Bob');
  await join(mia, 'MEMBER');
  await join(vic, 'VIEWER');
  projectId = await firstProject(alice);
});

describe('tạo, đọc, liệt kê', () => {
  it('POST 201 TaskDto: TODO, key TF-1, version 1, createdBy là người tạo; GET + list trả lại đúng task', async () => {
    const { res, task } = await createTask(mia, {
      title: '  Viết test  ',
      priority: 'HIGH',
      dueDate: '2026-11-30',
    });
    expect(res.status).toBe(201);
    expect(task).toMatchObject({
      key: 'TF-1',
      status: 'TODO',
      version: 1,
      createdBy: { id: mia.id },
      assignee: null,
    });
    expect(envelopeOf(res).data).toMatchObject({
      title: 'Viết test',
      priority: 'HIGH',
      dueDate: '2026-11-30',
    });

    const got = await request(t.app).get(`${inA()}/${task.id}`).set(vic.auth);
    expect(envelopeOf<Task>(got).data?.id).toBe(task.id);
    const list = await request(t.app).get(inA()).set(vic.auth);
    expect(envelopeOf<Task[]>(list).data?.map((x) => x.id)).toEqual([task.id]);
    expect(envelopeOf(list).meta.page).toMatchObject({ hasMore: false, limit: 200 });
  });

  it('lọc assigneeId=none / status; phân trang cursor', async () => {
    const a = (await createTask(alice, { title: 'Task A' })).task;
    await createTask(alice, { title: 'Task B', assigneeId: mia.id });
    const none = await request(t.app).get(`${inA()}?assigneeId=none`).set(alice.auth);
    expect(envelopeOf<Task[]>(none).data?.map((x) => x.id)).toEqual([a.id]);
    const page1 = await request(t.app).get(`${inA()}?limit=1`).set(alice.auth);
    const cursor = envelopeOf(page1).meta.page?.nextCursor ?? '';
    const page2 = await request(t.app).get(`${inA()}?limit=1&cursor=${cursor}`).set(alice.auth);
    expect(envelopeOf<Task[]>(page2).data).toHaveLength(1);
    expect(envelopeOf<Task[]>(page2).data?.[0]?.id).not.toBe(
      envelopeOf<Task[]>(page1).data?.[0]?.id,
    );
  });

  it('SEC mass assignment: field lạ (version, createdById, status) ⇒ 400', async () => {
    const { res } = await createTask(mia, {
      title: 'x x x',
      status: 'DONE',
      createdById: bob.id,
      version: 9,
    });
    expect(res.status).toBe(400);
  });
});

describe('IDOR & thứ tự kiểm (ADR-020, data-and-api §2.2)', () => {
  it('người ngoài workspace ⇒ 404 workspace (giống uuid không tồn tại); project ws khác dưới URL ws của mình ⇒ 404 project', async () => {
    const { task } = await createTask(alice);
    const foreign = await request(t.app).get(`${inA()}/${task.id}`).set(bob.auth);
    expect(errorOf(foreign)).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'workspace' },
    });
    const crossProject = await request(t.app)
      .get(`${base(bob, projectId, bob.workspaceId)}/${task.id}`)
      .set(bob.auth);
    expect(errorOf(crossProject)).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'project' },
    });
  });

  it('task của project khác (cùng ws) dưới URL project này ⇒ 404 task', async () => {
    const { task } = await createTask(alice);
    const other = await request(t.app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/projects`)
      .set(alice.auth)
      .send({ name: 'Web', keyPrefix: 'WEB' });
    const otherId = envelopeOf<{ id: string }>(other).data?.id ?? '';
    const res = await request(t.app)
      .get(`${inA(otherId)}/${task.id}`)
      .set(alice.auth);
    expect(errorOf(res)).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'task' },
    });
  });

  it('401 → 400 uuid → 404 → 403 (VIEWER tạo) ; VIEWER gửi body sai ⇒ 403 (không lộ luật validate) ; MEMBER body sai ⇒ 400', async () => {
    expect((await request(t.app).get(inA())).status).toBe(401);
    expect((await request(t.app).get(`${inA()}/not-a-uuid`).set(alice.auth)).status).toBe(400);
    expect((await createTask(vic)).res.status).toBe(403);
    const viewerBad = await createTask(vic, { bogus: 1 });
    expect(errorOf(viewerBad.res)).toMatchObject({
      code: 'FORBIDDEN_ACCESS',
      details: { required: 'task:create' },
    });
    expect((await createTask(mia, { bogus: 1 })).res.status).toBe(400);
  });
});

describe('cập nhật / di chuyển / gán / xóa', () => {
  it('PATCH với expectedVersion ⇒ version+1; version cũ ⇒ 409 VERSION_CONFLICT kèm current (FE hòa giải không refetch)', async () => {
    const { task } = await createTask(mia);
    const patch = (expectedVersion: number) =>
      request(t.app)
        .patch(`${inA()}/${task.id}`)
        .set(mia.auth)
        .send({ expectedVersion, title: 'Đổi tên' });
    expect(envelopeOf<Task>(await patch(1)).data?.version).toBe(2);
    const stale = await patch(1);
    expect(stale.status).toBe(409);
    expect(errorOf(stale)).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 2, current: { id: task.id, version: 2 } },
    });
  });

  it('move hợp lệ đổi cột; chuyển không cho phép ⇒ 422 INVALID_STATUS_TRANSITION kèm allowed', async () => {
    const { task } = await createTask(mia);
    const allowed = TASK_STATUS_TRANSITIONS.TODO as readonly string[];
    const target = allowed[0] ?? 'IN_PROGRESS';
    const moved = await request(t.app)
      .patch(`${inA()}/${task.id}/move`)
      .set(mia.auth)
      .send({ expectedVersion: 1, status: target });
    expect(envelopeOf<Task>(moved).data).toMatchObject({ status: target, version: 2 });

    const forbidden = (['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const).find(
      (s) =>
        s !== target &&
        !(TASK_STATUS_TRANSITIONS[target as 'TODO'] as readonly string[]).includes(s),
    );
    if (forbidden) {
      const bad = await request(t.app)
        .patch(`${inA()}/${task.id}/move`)
        .set(mia.auth)
        .send({ expectedVersion: 2, status: forbidden });
      expect(errorOf(bad)).toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
        details: { from: target, to: forbidden },
      });
    }
  });

  it('assign: người không phải thành viên ⇒ 422 ASSIGNEE_NOT_MEMBER; MEMBER gán người khác cho task không phải của mình ⇒ 403', async () => {
    const { task } = await createTask(alice);
    const assign = (u: TestUser, assigneeId: string | null, v = 1) =>
      request(t.app)
        .patch(`${inA()}/${task.id}/assignee`)
        .set(u.auth)
        .send({ expectedVersion: v, assigneeId });
    const outsider = await assign(alice, bob.id);
    expect(errorOf(outsider)).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      details: { rule: 'ASSIGNEE_NOT_MEMBER' },
    });
    expect((await assign(mia, alice.id)).status).toBe(403);
    const self = await assign(mia, mia.id); // tự nhận task chưa có người (ADR-041)
    expect(envelopeOf<Task>(self).data?.assignee?.id).toBe(mia.id);
  });

  it('delete: MEMBER xóa task người khác tạo ⇒ 403; OWNER ⇒ {id, version}; sau đó GET 404 nhưng audit-logs vẫn đọc được', async () => {
    const { task } = await createTask(alice);
    expect((await request(t.app).delete(`${inA()}/${task.id}`).set(mia.auth)).status).toBe(403);
    const del = await request(t.app)
      .delete(`${inA()}/${task.id}?expectedVersion=1`)
      .set(alice.auth);
    expect(envelopeOf(del).data).toEqual({ id: task.id, version: 2 });
    expect((await request(t.app).get(`${inA()}/${task.id}`).set(alice.auth)).status).toBe(404);
    const audit = await request(t.app).get(`${inA()}/${task.id}/audit-logs`).set(vic.auth);
    expect(envelopeOf<{ action: string }[]>(audit).data?.map((a) => a.action)).toEqual([
      'DELETED',
      'CREATED',
    ]);
  });

  it('project archived ⇒ tạo/sửa 422 PROJECT_ARCHIVED', async () => {
    const { task } = await createTask(alice);
    await request(t.app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/projects/${projectId}/archive`)
      .set(alice.auth)
      .set('Content-Type', 'application/json');
    expect(errorOf((await createTask(alice)).res).code).toBe('PROJECT_ARCHIVED');
    const patch = await request(t.app)
      .patch(`${inA()}/${task.id}`)
      .set(alice.auth)
      .send({ expectedVersion: 1, title: 'x x x' });
    expect(errorOf(patch).code).toBe('PROJECT_ARCHIVED');
  });

  it('xóa thành viên ⇒ task đang gán cho họ được bỏ gán (cleaner thật của Task, ADR-044)', async () => {
    const { task } = await createTask(alice, { title: 'Gán cho Mia', assigneeId: mia.id });
    const removed = await request(t.app)
      .delete(`/api/v1/workspaces/${alice.workspaceId}/members/${mia.id}`)
      .set(alice.auth);
    expect(envelopeOf(removed).data).toEqual({ userId: mia.id, unassignedTaskCount: 1 });
    const after = await request(t.app).get(`${inA()}/${task.id}`).set(alice.auth);
    expect(envelopeOf<Task>(after).data?.assignee).toBeNull();
  });
});
