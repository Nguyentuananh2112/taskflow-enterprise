// T-040: `/api/v1/me/notifications` (ADR-123, attendance-leave.md §5 + §9 B-M3 / B-H3b, test-spec-hr SEC-HR-17…19).
// Thông báo được tạo qua `publisher.notify` trong `uow.run` — đúng cách leave / attendance gọi (chưa có route
// của họ trên nhánh này); membership / grants đổi qua route thật của Workspace.
import { NotificationDto } from '@taskflow/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

const BASE = '/api/v1/me/notifications';
const REQ = '0000aaaa-0000-7000-8000-00000000aaaa';

let t: TestApp;
let alice: TestUser; // OWNER
let hana: TestUser; // MEMBER + HR_MANAGE
let mia: TestUser; // MEMBER
let wsId: string;

const get = (by: TestUser, path = '') => request(t.app).get(`${BASE}${path}`).set(by.auth);
// POST không body vẫn phải là JSON (chống CSRF — security.md §6.3; web luôn gửi `{}`).
const post = (by: TestUser, path: string) =>
  request(t.app).post(`${BASE}${path}`).set(by.auth).set('Content-Type', 'application/json');
const count = async (by: TestUser) =>
  envelopeOf<{ count: number }>(await get(by, '/unread-count')).data?.count;
const list = async (by: TestUser, query = '') =>
  envelopeOf<NotificationDto[]>(await get(by, query)).data ?? [];

/** Mia gửi đơn ⇒ báo mọi HR hiện tại (như `ILeaveNotifier` của T-039 gọi trong transaction gửi đơn). */
const miaSubmits = () =>
  t.persistence.uow.run(() =>
    t.container.notifications.publisher.notify({
      workspaceId: wsId,
      type: 'LEAVE_SUBMITTED',
      refId: REQ,
      actorId: mia.id,
      recipient: { kind: 'hr' },
    }),
  );

beforeEach(async () => {
  t = createTestApp();
  alice = await t.register('Alice');
  wsId = alice.workspaceId;
  [hana, mia] = [await t.register('Hana'), await t.register('Mia')];
  for (const u of [hana, mia]) {
    const res = await request(t.app)
      .post(`/api/v1/workspaces/${wsId}/members`)
      .set(alice.auth)
      .send({ email: u.email, role: 'MEMBER' });
    expect(res.status).toBe(201);
  }
  const granted = await request(t.app)
    .put(`/api/v1/workspaces/${wsId}/members/${hana.id}/grants`)
    .set(alice.auth)
    .send({ grants: ['HR_MANAGE'] });
  expect(granted.status).toBe(200);
});

describe('GET /me/notifications', () => {
  it('chưa đăng nhập ⇒ 401 ở cả 4 route', async () => {
    for (const res of [
      await request(t.app).get(BASE),
      await request(t.app).get(`${BASE}/unread-count`),
      await request(t.app).post(`${BASE}/read-all`).set('Content-Type', 'application/json'),
      await request(t.app).post(`${BASE}/${REQ}/read`).set('Content-Type', 'application/json'),
    ]) {
      expect(res.status).toBe(401);
    }
  });

  it('fan-out tới OWNER + HR, không tới người gửi; DTO đúng contract, có tên ws + actor, không lý do', async () => {
    await miaSubmits();
    for (const hr of [alice, hana]) {
      const res = await get(hr);
      expect(res.status).toBe(200);
      const { data, meta } = envelopeOf<NotificationDto[]>(res);
      expect(meta?.page).toMatchObject({ hasMore: false, nextCursor: null, limit: 20 });
      expect(data).toHaveLength(1);
      expect(NotificationDto.strict().parse(data?.[0])).toMatchObject({
        type: 'LEAVE_SUBMITTED',
        refId: REQ,
        workspaceId: wsId,
        actor: { id: mia.id, fullName: 'Mia' },
        leave: null, // chế độ bộ nhớ chưa có module leave
        readAt: null,
      });
      expect(data?.[0]?.workspaceName).toBeTruthy();
      expect(await count(hr)).toBe(1);
    }
    expect(await list(mia)).toEqual([]);
    expect(await count(mia)).toBe(0);
  });

  it('SEC-HR-03: `?userId=` của người khác bị bỏ qua — luôn chỉ của người gọi', async () => {
    await miaSubmits();
    expect(await list(mia, `?userId=${hana.id}`)).toEqual([]);
  });

  it('phân trang cursor: limit=1 ⇒ nextCursor; cursor sai loại / limit ngoài [1,50] ⇒ 400', async () => {
    await miaSubmits();
    await miaSubmits();
    const first = envelopeOf<NotificationDto[]>(await get(hana, '?limit=1'));
    expect(first.data).toHaveLength(1);
    const cursor = first.meta?.page?.nextCursor;
    expect(cursor).toBeTruthy();
    const second = envelopeOf<NotificationDto[]>(
      await get(hana, `?limit=1&cursor=${encodeURIComponent(cursor ?? '')}`),
    );
    expect(second.data?.[0]?.id).not.toBe(first.data?.[0]?.id);
    expect(second.meta?.page?.hasMore).toBe(false);

    const foreign = Buffer.from(JSON.stringify({ k: 'members', v: { after: REQ } })).toString(
      'base64url',
    );
    for (const q of [`?cursor=${foreign}`, '?limit=0', '?limit=51', '?cursor=%%%']) {
      expect((await get(hana, q)).status, q).toBe(400);
    }
  });

  it('SEC-HR-19: OWNER thu grant của Hana ⇒ thông báo dành cho HR biến khỏi chuông ở request kế tiếp', async () => {
    await miaSubmits();
    expect(await count(hana)).toBe(1);
    const revoked = await request(t.app)
      .put(`/api/v1/workspaces/${wsId}/members/${hana.id}/grants`)
      .set(alice.auth)
      .send({ grants: [] });
    expect(revoked.status).toBe(200);
    expect(await list(hana)).toEqual([]);
    expect(await count(hana)).toBe(0);
    expect(await count(alice)).toBe(1);
  });

  it('SEC-HR-18: bị xóa khỏi workspace ⇒ không còn thông báo của ws đó', async () => {
    await miaSubmits();
    const removed = await request(t.app)
      .delete(`/api/v1/workspaces/${wsId}/members/${hana.id}`)
      .set(alice.auth);
    expect(removed.status).toBe(200);
    expect(await list(hana)).toEqual([]);
    expect(await count(hana)).toBe(0);
  });
});

describe('POST /me/notifications/:id/read · /read-all', () => {
  it('SEC-HR-17: id của người khác ⇒ 404 notification (không đổi trạng thái); của mình ⇒ 204, lặp lại vẫn 204', async () => {
    await miaSubmits();
    const [n] = await list(hana);
    const id = n?.id ?? '';

    const foreign = await post(mia, `/${id}/read`);
    expect(foreign.status).toBe(404);
    expect(errorOf(foreign)).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'notification' },
    });
    expect(await count(hana)).toBe(1);

    expect((await post(hana, `/${id}/read`)).status).toBe(204);
    expect((await post(hana, `/${id}/read`)).status).toBe(204);
    expect(await count(hana)).toBe(0);
    expect((await list(hana))[0]?.readAt).not.toBeNull();
    expect(await count(alice)).toBe(1); // bản của Alice là dòng riêng
  });

  it('id không phải uuid ⇒ 400; uuid không tồn tại ⇒ 404', async () => {
    expect((await post(hana, '/not-a-uuid/read')).status).toBe(400);
    expect((await post(hana, `/${REQ}/read`)).status).toBe(404);
  });

  it('read-all ⇒ 204, chỉ thông báo của người gọi', async () => {
    await miaSubmits();
    await miaSubmits();
    const res = await post(alice, '/read-all');
    expect(res.status).toBe(204);
    expect(await count(alice)).toBe(0);
    expect(await count(hana)).toBe(2);
  });
});
