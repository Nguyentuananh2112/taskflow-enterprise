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
  const res = await as(by).post(ws(`/${wsId}/members`), { userId: who.id, role });
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
  it('thêm theo userId (201 MemberDto); user lạ ⇒ 404 user; đã rời công ty ⇒ 422 NOT_ACTIVE_MEMBER; đã là thành viên ⇒ 409', async () => {
    const id = alice.workspaceId;
    const added = await as(alice).post(ws(`/${id}/members`), { userId: bob.id, role: 'MEMBER' });
    expect(added.status).toBe(201);
    expect(envelopeOf(added).data).toMatchObject({
      userId: bob.id,
      email: bob.email,
      fullName: 'Bob',
      role: 'MEMBER',
    });
    const ghost = await as(alice).post(ws(`/${id}/members`), {
      userId: '00000000-0000-7000-8000-0000000fffff',
      role: 'MEMBER',
    });
    expect(errorOf(ghost)).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'user' },
    });
    const gone = await t.register('Gone');
    t.companyStore.removeMember(gone.id); // đã nghỉ việc (SEC-HR-37)
    const left = await as(alice).post(ws(`/${id}/members`), { userId: gone.id, role: 'MEMBER' });
    expect(left.status).toBe(422);
    expect(errorOf(left)).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      details: { rule: 'NOT_ACTIVE_MEMBER' },
    });
    expect(
      (await as(alice).post(ws(`/${id}/members`), { userId: bob.id, role: 'VIEWER' })).status,
    ).toBe(409);
  });

  it('PM thêm role PM ⇒ 403 (Policy); MEMBER thêm ai ⇒ 403 (min role)', async () => {
    const id = alice.workspaceId;
    const carol = await t.register('Carol');
    const dave = await t.register('Dave');
    await addMember(alice, id, bob, 'PM');
    await addMember(alice, id, carol, 'MEMBER');
    expect((await as(bob).post(ws(`/${id}/members`), { userId: dave.id, role: 'PM' })).status).toBe(
      403,
    );
    expect(
      (await as(bob).post(ws(`/${id}/members`), { userId: dave.id, role: 'MEMBER' })).status,
    ).toBe(201);
    expect(
      (await as(carol).post(ws(`/${id}/members`), { userId: dave.id, role: 'VIEWER' })).status,
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

    // F3 W-10: KHÔNG có cursor dự phòng hardcode — trước đây nó che việc GET /projects?limit=1 hỏng.
    // Workspace mặc định có 1 project ⇒ tạo thêm 1 để trang đầu có nextCursor thật.
    expect(
      (await as(alice).post(ws(`/${id}/projects`), { name: 'Hai', keyPrefix: 'HAI' })).status,
    ).toBe(201);
    const projectsPage = await as(alice).get(ws(`/${id}/projects?limit=1`));
    expect(projectsPage.status).toBe(200);
    expect(envelopeOf(projectsPage).meta.page).toMatchObject({ hasMore: true, limit: 1 });
    const projectCursor = envelopeOf(projectsPage).meta.page?.nextCursor;
    expect(projectCursor).toEqual(expect.any(String));
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

// F3 W-10 / W-11 (mutation, report §4.1): validate ở route chạy với người CÓ quyền (để không bị chặn
// 403/404 trước), và route GET project có ca thành công.
describe('F3: validate ở route với người có quyền + GET project thành công', () => {
  it('W-10: body / params / query sai từ OWNER ⇒ 400 VALIDATION_ERROR (schema strict ở route)', async () => {
    const id = alice.workspaceId;
    const projects = await as(alice).get(ws(`/${id}/projects`));
    const projectId = envelopeOf<{ id: string }[]>(projects).data?.[0]?.id ?? '';
    expect(projectId).not.toBe('');
    const bad: [string, () => ReturnType<ReturnType<typeof as>['get']>][] = [
      ['PATCH ws name số', () => as(alice).patch(ws(`/${id}`), { name: 123 })],
      ['PATCH ws field lạ', () => as(alice).patch(ws(`/${id}`), { name: 'x', deletedAt: null })],
      ['restore wsId không phải uuid', () => as(alice).post(ws('/not-a-uuid/restore'))],
      [
        'thêm member theo email (Mốc 3.5 chỉ nhận userId)',
        () => as(alice).post(ws(`/${id}/members`), { email: 'abc@example.com', role: 'VIEWER' }),
      ],
      [
        'tạo project kèm workspaceId (mass assignment)',
        () =>
          as(alice).post(ws(`/${id}/projects`), {
            name: 'Ba',
            keyPrefix: 'BAA',
            workspaceId: RANDOM_WS,
          }),
      ],
      [
        'sửa project kèm keyPrefix (bất biến)',
        () => as(alice).patch(ws(`/${id}/projects/${projectId}`), { name: 'Ok', keyPrefix: 'NEW' }),
      ],
    ];
    for (const [label, send] of bad) {
      const res = await send();
      expect(res.status, `${label}: ${res.text.slice(0, 200)}`).toBe(400);
      expect(errorOf(res).code, label).toBe('VALIDATION_ERROR');
    }
  });

  it('W-19: query / body strict — ?deleted=yes, DELETE thiếu confirmSlug / có field lạ, PATCH member có field lạ ⇒ 400', async () => {
    const id = alice.workspaceId;
    await addMember(alice, id, bob, 'MEMBER');
    const list = await as(alice).get(ws('?deleted=yes'));
    expect(list.status, list.text.slice(0, 200)).toBe(400);
    const del = await as(alice).delete(ws(`/${id}`), {});
    expect(del.status).toBe(400);
    expect(errorOf(del).details?.issues?.map((i) => i.path.join('.'))).toContain('confirmSlug');
    // confirmSlug ĐÚNG + field lạ: chỉ schema strict chặn được (use case sẽ xóa thật).
    const slug = envelopeOf<{ slug: string }>(await as(alice).get(ws(`/${id}`))).data?.slug;
    const extra = await as(alice).delete(ws(`/${id}`), { confirmSlug: slug, force: true });
    expect(extra.status, extra.text.slice(0, 200)).toBe(400);
    const role = await as(alice).patch(ws(`/${id}/members/${bob.id}`), { role: 'PM', x: 1 });
    expect(role.status, role.text.slice(0, 200)).toBe(400);
    expect(errorOf(role).code).toBe('VALIDATION_ERROR');
    // Đối chứng: workspace chưa bị xóa, bob vẫn MEMBER (các request trên không làm gì).
    expect((await as(alice).get(ws(`/${id}`))).status).toBe(200);
  });

  it('W-11: VIEWER / MEMBER của chính ws GET /projects/:id ⇒ 200, đúng ProjectDto của project đó', async () => {
    const id = alice.workspaceId;
    const carol = await t.register('Carol');
    await addMember(alice, id, bob, 'VIEWER');
    await addMember(alice, id, carol, 'MEMBER');
    const list = await as(alice).get(ws(`/${id}/projects`));
    const project = envelopeOf<{ id: string; keyPrefix: string; name: string }[]>(list).data?.[0];
    expect(project).toBeDefined();
    for (const who of [bob, carol]) {
      const res = await as(who).get(ws(`/${id}/projects/${project!.id}`));
      expect(res.status, res.text.slice(0, 200)).toBe(200);
      expect(envelopeOf(res).data).toMatchObject({
        id: project!.id,
        workspaceId: id,
        keyPrefix: project!.keyPrefix,
        name: project!.name,
      });
    }
  });
});
