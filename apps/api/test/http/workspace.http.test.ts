// Route /api/v1/workspaces (data-and-api §2.5) + thứ tự kiểm 401→400→404→403→422 (§2.2), IDOR (ADR-020).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let alice: TestUser; // OWNER workspace A (workspace mặc định khi đăng ký)
let bob: TestUser; // OWNER workspace B, không thuộc A
const RANDOM_WS = '0199e5a2-7c1e-7cc3-9a3b-ffffffffffff';

beforeEach(async () => {
  t = createTestApp();
  alice = await t.register('Alice');
  bob = await t.register('Bob');
});

const ws = (path = '') => `/api/v1/workspaces${path}`;
const as = (u: TestUser) => ({
  get: (p: string) => request(t.app).get(p).set(u.auth),
  post: (p: string, body?: object) =>
    request(t.app)
      .post(p)
      .set(u.auth)
      .send(body ?? {}),
  patch: (p: string, body: object) => request(t.app).patch(p).set(u.auth).send(body),
  delete: (p: string, body?: object) => {
    const req = request(t.app).delete(p).set(u.auth);
    return body ? req.send(body) : req;
  },
});

async function addMember(by: TestUser, wsId: string, who: TestUser, role: string) {
  const res = await as(by).post(ws(`/${wsId}/members`), { email: who.email, role });
  expect(res.status).toBe(201);
}

describe('workspace CRUD', () => {
  it('GET /workspaces: workspace của tôi với myRole', async () => {
    const res = await as(alice).get(ws());
    expect(envelopeOf<{ id: string; myRole: string }[]>(res).data).toEqual([
      expect.objectContaining({ id: alice.workspaceId, myRole: 'OWNER' }),
    ]);
  });

  it('POST /workspaces: 201 người tạo là OWNER; slug trùng ⇒ 409 RESOURCE_CONFLICT field=slug', async () => {
    const created = await as(alice).post(ws(), { name: 'Đội Kỹ Thuật', slug: 'doi-ky-thuat' });
    expect(created.status).toBe(201);
    expect(envelopeOf(created).data).toMatchObject({ slug: 'doi-ky-thuat', myRole: 'OWNER' });
    const dup = await as(bob).post(ws(), { name: 'Khác', slug: 'doi-ky-thuat' });
    expect(dup.status).toBe(409);
    expect(errorOf(dup)).toMatchObject({ code: 'RESOURCE_CONFLICT', details: { field: 'slug' } });
  });

  it('slug chữ hoa ⇒ 400 (không tự lowercase); field lạ ⇒ 400', async () => {
    expect((await as(alice).post(ws(), { name: 'X', slug: 'Doi-KT' })).status).toBe(400);
    expect((await as(alice).post(ws(), { name: 'X', ownerId: bob.id })).status).toBe(400);
  });

  it('PATCH (OWNER) đổi tên; DELETE confirmSlug sai ⇒ 400; đúng ⇒ xóa mềm, GET ⇒ 404; restore ⇒ 200', async () => {
    const id = alice.workspaceId;
    expect(envelopeOf(await as(alice).patch(ws(`/${id}`), { name: 'Đổi tên' })).data).toMatchObject(
      { name: 'Đổi tên' },
    );
    const slug = (
      envelopeOf<{ slug: string }>(await as(alice).get(ws(`/${id}`))).data as { slug: string }
    ).slug;

    expect((await as(alice).delete(ws(`/${id}`), { confirmSlug: 'nope' })).status).toBe(400);
    const deleted = await as(alice).delete(ws(`/${id}`), { confirmSlug: slug });
    expect(deleted.status).toBe(200);
    expect(envelopeOf(deleted).data).toMatchObject({
      id,
      deletedAt: expect.any(String) as string,
      purgeAt: expect.any(String) as string,
    });

    expect((await as(alice).get(ws(`/${id}`))).status).toBe(404);
    expect(envelopeOf<unknown[]>(await as(alice).get(ws('?deleted=true'))).data).toHaveLength(1);
    const restored = await as(alice).post(ws(`/${id}/restore`));
    expect(restored.status).toBe(200);
    expect((await as(alice).get(ws(`/${id}`))).status).toBe(200);
  });

  it('restore bởi người không phải OWNER / workspace chưa xóa ⇒ 404', async () => {
    expect((await as(bob).post(ws(`/${alice.workspaceId}/restore`))).status).toBe(404);
    expect((await as(alice).post(ws(`/${alice.workspaceId}/restore`))).status).toBe(404);
  });
});

describe('IDOR & thứ tự kiểm lỗi (ADR-020, data-and-api §2.2)', () => {
  it('Bob truy cập workspace của Alice ⇒ 404 GIỐNG HỆT uuid không tồn tại (không lộ sự tồn tại)', async () => {
    for (const path of ['', '/members', '/projects']) {
      const foreign = await as(bob).get(ws(`/${alice.workspaceId}${path}`));
      const missing = await as(bob).get(ws(`/${RANDOM_WS}${path}`));
      expect(foreign.status).toBe(404);
      expect(errorOf(foreign)).toEqual(errorOf(missing));
    }
    expect((await as(bob).patch(ws(`/${alice.workspaceId}`), { name: 'hack' })).status).toBe(404);
  });

  it('401 trước mọi thứ; 400 uuid sai trước 404; 404 trước 403; 403 trước 400 body', async () => {
    expect((await request(t.app).get(ws(`/${alice.workspaceId}`))).status).toBe(401);
    expect((await as(bob).get(ws('/not-a-uuid'))).status).toBe(400);
    expect((await as(bob).patch(ws(`/${alice.workspaceId}`), { name: 'x' })).status).toBe(404);
    await addMember(alice, alice.workspaceId, bob, 'VIEWER');
    // VIEWER gửi body sai lên route cần OWNER ⇒ 403 (không lộ luật validate).
    const res = await as(bob).patch(ws(`/${alice.workspaceId}`), { bogus: true });
    expect(res.status).toBe(403);
    expect(errorOf(res)).toMatchObject({
      code: 'FORBIDDEN_ACCESS',
      details: { required: 'workspace:update' },
    });
  });
});

describe('members', () => {
  it('thêm theo email (201 MemberDto); email lạ ⇒ 404 user; đã là thành viên ⇒ 409', async () => {
    const id = alice.workspaceId;
    const added = await as(alice).post(ws(`/${id}/members`), { email: bob.email, role: 'MEMBER' });
    expect(added.status).toBe(201);
    expect(envelopeOf(added).data).toMatchObject({
      userId: bob.id,
      email: bob.email,
      fullName: 'Bob',
      role: 'MEMBER',
    });
    const ghost = await as(alice).post(ws(`/${id}/members`), {
      email: 'ghost@example.com',
      role: 'MEMBER',
    });
    expect(errorOf(ghost)).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'user' },
    });
    expect(
      (await as(alice).post(ws(`/${id}/members`), { email: bob.email, role: 'VIEWER' })).status,
    ).toBe(409);
  });

  it('PM thêm role PM ⇒ 403 (Policy); MEMBER thêm ai ⇒ 403 (min role)', async () => {
    const id = alice.workspaceId;
    const carol = await t.register('Carol');
    const dave = await t.register('Dave');
    await addMember(alice, id, bob, 'PM');
    await addMember(alice, id, carol, 'MEMBER');
    expect(
      (await as(bob).post(ws(`/${id}/members`), { email: dave.email, role: 'PM' })).status,
    ).toBe(403);
    expect(
      (await as(bob).post(ws(`/${id}/members`), { email: dave.email, role: 'MEMBER' })).status,
    ).toBe(201);
    expect(
      (await as(carol).post(ws(`/${id}/members`), { email: 'x@example.com', role: 'VIEWER' }))
        .status,
    ).toBe(403);
  });

  it('danh sách: q lọc không phân biệt hoa thường; phân trang cursor opaque; cursor của endpoint khác ⇒ 400', async () => {
    const id = alice.workspaceId;
    await addMember(alice, id, bob, 'MEMBER');
    const filtered = await as(alice).get(ws(`/${id}/members?q=BOB`));
    expect(envelopeOf<{ userId: string }[]>(filtered).data?.map((m) => m.userId)).toEqual([bob.id]);

    const page1 = await as(alice).get(ws(`/${id}/members?limit=1`));
    const meta1 = envelopeOf(page1).meta.page;
    expect(meta1).toMatchObject({ hasMore: true, limit: 1 });
    const page2 = await as(alice).get(
      ws(`/${id}/members?limit=1&cursor=${meta1?.nextCursor ?? ''}`),
    );
    expect(envelopeOf<{ userId: string }[]>(page2).data?.map((m) => m.userId)).toEqual([bob.id]);
    expect(envelopeOf(page2).meta.page).toMatchObject({ nextCursor: null, hasMore: false });

    const projectsPage = await as(alice).get(ws(`/${id}/projects?limit=1`));
    const projectCursor =
      envelopeOf(projectsPage).meta.page?.nextCursor ??
      'eyJrIjoicHJvamVjdHMiLCJ2Ijp7ImFmdGVyIjoieCJ9fQ';
    const misuse = await as(alice).get(ws(`/${id}/members?cursor=${projectCursor}`));
    expect(misuse.status).toBe(400);
    expect(errorOf(misuse).details?.issues?.[0]?.path).toEqual(['cursor']);
    expect((await as(alice).get(ws(`/${id}/members?limit=101`))).status).toBe(400);
  });

  it('đổi role (OWNER); hạ OWNER cuối cùng ⇒ 422 LAST_OWNER; tự rời ⇒ 200; PM xóa OWNER ⇒ 403', async () => {
    const id = alice.workspaceId;
    const carol = await t.register('Carol');
    await addMember(alice, id, bob, 'MEMBER');
    await addMember(alice, id, carol, 'PM');
    const changed = await as(alice).patch(ws(`/${id}/members/${bob.id}`), { role: 'VIEWER' });
    expect(envelopeOf(changed).data).toMatchObject({
      member: { role: 'VIEWER' },
      unassignedTaskCount: 0,
    });

    const lastOwner = await as(alice).patch(ws(`/${id}/members/${alice.id}`), { role: 'PM' });
    expect(lastOwner.status).toBe(422);
    expect(errorOf(lastOwner)).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      details: { rule: 'LAST_OWNER' },
    });

    expect((await as(carol).delete(ws(`/${id}/members/${alice.id}`))).status).toBe(403);
    const left = await as(bob).delete(ws(`/${id}/members/${bob.id}`));
    expect(envelopeOf(left).data).toEqual({ userId: bob.id, unassignedTaskCount: 0 });
    expect((await as(bob).get(ws(`/${id}`))).status).toBe(404);
  });
});
