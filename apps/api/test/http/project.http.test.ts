// Route /api/v1/workspaces/:wsId/projects (data-and-api §2.6).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  t = createTestApp();
  alice = await t.register('Alice');
  bob = await t.register('Bob');
});

const projects = (wsId: string, path = '') => `/api/v1/workspaces/${wsId}/projects${path}`;

async function createProject(u: TestUser, wsId: string, body: object) {
  return request(t.app).post(projects(wsId)).set(u.auth).send(body);
}

describe('projects', () => {
  it('workspace mặc định có project "Dự án đầu tiên" (TF) — ADR-103', async () => {
    const res = await request(t.app).get(projects(alice.workspaceId)).set(alice.auth);
    expect(envelopeOf<{ name: string; keyPrefix: string }[]>(res).data).toEqual([
      expect.objectContaining({ name: 'Dự án đầu tiên', keyPrefix: 'TF', isArchived: false }),
    ]);
  });

  it('tạo 201 ProjectDto; keyPrefix trùng ⇒ 409 field=keyPrefix; keyPrefix sai định dạng ⇒ 400', async () => {
    const created = await createProject(alice, alice.workspaceId, {
      name: 'Web',
      keyPrefix: 'WEB',
    });
    expect(created.status).toBe(201);
    expect(envelopeOf(created).data).toMatchObject({
      workspaceId: alice.workspaceId,
      name: 'Web',
      keyPrefix: 'WEB',
      description: null,
      archivedAt: null,
    });
    const dup = await createProject(alice, alice.workspaceId, { name: 'Web 2', keyPrefix: 'WEB' });
    expect(errorOf(dup)).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      details: { field: 'keyPrefix' },
    });
    expect(
      (await createProject(alice, alice.workspaceId, { name: 'x', keyPrefix: 'web' })).status,
    ).toBe(400);
  });

  it('MEMBER tạo project ⇒ 403 (cần PM)', async () => {
    await request(t.app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/members`)
      .set(alice.auth)
      .send({ email: bob.email, role: 'MEMBER' });
    expect(
      (await createProject(bob, alice.workspaceId, { name: 'x', keyPrefix: 'XX' })).status,
    ).toBe(403);
  });

  it('IDOR: project của workspace khác dưới URL workspace của tôi ⇒ 404 project', async () => {
    const bobProjects = await request(t.app).get(projects(bob.workspaceId)).set(bob.auth);
    const bobProjectId = envelopeOf<{ id: string }[]>(bobProjects).data?.[0]?.id ?? '';
    const res = await request(t.app)
      .get(projects(alice.workspaceId, `/${bobProjectId}`))
      .set(alice.auth);
    expect(res.status).toBe(404);
    expect(errorOf(res).details).toEqual({ resource: 'project' });
  });

  it('archive (idempotent) ⇒ PATCH 422 PROJECT_ARCHIVED; lọc archived; unarchive ⇒ sửa lại được', async () => {
    const id = (
      envelopeOf<{ id: string }>(
        await createProject(alice, alice.workspaceId, { name: 'Web', keyPrefix: 'WEB' }),
      ).data as { id: string }
    ).id;
    const archive = () =>
      request(t.app)
        .post(projects(alice.workspaceId, `/${id}/archive`))
        .set(alice.auth)
        .set('Content-Type', 'application/json');
    expect(envelopeOf(await archive()).data).toMatchObject({ isArchived: true });
    expect((await archive()).status).toBe(200);

    const patch = (body: object) =>
      request(t.app)
        .patch(projects(alice.workspaceId, `/${id}`))
        .set(alice.auth)
        .send(body);
    const blocked = await patch({ name: 'Mới' });
    expect(blocked.status).toBe(422);
    expect(errorOf(blocked)).toMatchObject({
      code: 'PROJECT_ARCHIVED',
      details: { projectId: id },
    });

    const list = (archived: string) =>
      request(t.app)
        .get(projects(alice.workspaceId, `?archived=${archived}`))
        .set(alice.auth);
    expect(envelopeOf<{ id: string }[]>(await list('true')).data?.map((p) => p.id)).toEqual([id]);
    expect(envelopeOf<unknown[]>(await list('false')).data).toHaveLength(1);
    expect(envelopeOf<unknown[]>(await list('all')).data).toHaveLength(2);

    await request(t.app)
      .post(projects(alice.workspaceId, `/${id}/unarchive`))
      .set(alice.auth)
      .set('Content-Type', 'application/json');
    expect(envelopeOf(await patch({ name: 'Mới', description: 'mô tả' })).data).toMatchObject({
      name: 'Mới',
      description: 'mô tả',
    });
  });

  it('PATCH keyPrefix (bất biến) ⇒ 400; body rỗng ⇒ 400', async () => {
    const id =
      (envelopeOf<{ id: string }[]>(
        await request(t.app).get(projects(alice.workspaceId)).set(alice.auth),
      ).data ?? [])[0]?.id ?? '';
    const patch = (body: object) =>
      request(t.app)
        .patch(projects(alice.workspaceId, `/${id}`))
        .set(alice.auth)
        .send(body);
    expect((await patch({ keyPrefix: 'NEW' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });

  it('thứ tự security.md (TL quyết ở T-024): project không tồn tại ⇒ 404 TRƯỚC 403; có project ⇒ 403; body sai không lộ ⇒ 403', async () => {
    await request(t.app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/members`)
      .set(alice.auth)
      .send({ email: bob.email, role: 'VIEWER' });
    const missing = '0199e5a2-7c1e-7cc3-9a3b-ffffffffffff';
    const existing =
      (envelopeOf<{ id: string }[]>(
        await request(t.app).get(projects(alice.workspaceId)).set(alice.auth),
      ).data ?? [])[0]?.id ?? '';
    const patch = (pid: string, body: object) =>
      request(t.app)
        .patch(projects(alice.workspaceId, `/${pid}`))
        .set(bob.auth)
        .send(body);

    const notFound = await patch(missing, { name: 'Mới' });
    expect(notFound.status).toBe(404);
    expect(errorOf(notFound).details).toEqual({ resource: 'project' });
    for (const action of ['archive', 'unarchive']) {
      const res = await request(t.app)
        .post(projects(alice.workspaceId, `/${missing}/${action}`))
        .set(bob.auth)
        .set('Content-Type', 'application/json');
      expect(res.status).toBe(404);
    }

    expect((await patch(existing, { name: 'Mới' })).status).toBe(403);
    expect((await patch(existing, { bogus: true })).status).toBe(403);
  });
});
