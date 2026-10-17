// T-040: `/api/v1/me/notifications` (ADR-123, attendance-leave.md §5 + §9 B-M3 / B-H3b, test-spec-hr SEC-HR-17…19).
// Thông báo được tạo qua `publisher.notify` trong `uow.run` — đúng cách leave / attendance gọi (chưa có route
// của họ trên nhánh này). Mốc 3.5: quyền HR là quyền CÔNG TY — đổi thẳng trong store company (route admin/access
// có test riêng).
import { NotificationDto } from '@taskflow/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

const BASE = '/api/v1/me/notifications';
const REQ = '0000aaaa-0000-7000-8000-00000000aaaa';

let t: TestApp;
let alice: TestUser; // ADMIN (hr:manage qua role)
let hana: TestUser; // EMPLOYEE + HR_MANAGE
let mia: TestUser; // EMPLOYEE

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
      type: 'LEAVE_SUBMITTED',
      refId: REQ,
      actorId: mia.id,
      recipient: { kind: 'hr' },
    }),
  );

beforeEach(async () => {
  t = createTestApp();
  alice = await t.register('Alice', undefined, { role: 'ADMIN', workspace: false });
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'], workspace: false });
  mia = await t.register('Mia', undefined, { workspace: false });
});

/** Đổi grants công ty của một người (như `PUT /admin/access/:userId` — giữ nguyên tư cách). */
async function setGrants(userId: string, grants: 'HR_MANAGE'[]) {
  const m = await t.companyStore.find(userId);
  if (!m) throw new Error('không có dòng company_members');
  t.companyStore.upsertMember({ ...m, grants, version: m.version + 1 });
}

const typesOf = async (by: TestUser) => (await list(by)).map((n) => n.type);

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

  it('fan-out tới Admin + HR, không tới người gửi; DTO đúng contract (không còn ws), có actor, không lý do', async () => {
    await miaSubmits();
    for (const hr of [alice, hana]) {
      const res = await get(hr);
      expect(res.status).toBe(200);
      const { data: all, meta } = envelopeOf<NotificationDto[]>(res);
      expect(meta?.page).toMatchObject({ hasMore: false, nextCursor: null, limit: 20 });
      const data = all?.filter((n) => n.type === 'LEAVE_SUBMITTED');
      expect(data).toHaveLength(1);
      expect(NotificationDto.strict().parse(data?.[0])).toMatchObject({
        type: 'LEAVE_SUBMITTED',
        refId: REQ,
        actor: { id: mia.id, fullName: 'Mia' },
        leave: null, // chế độ bộ nhớ chưa có module leave
        readAt: null,
      });
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
    const first = envelopeOf<NotificationDto[]>(await get(alice, '?limit=1'));
    expect(first.data).toHaveLength(1);
    const cursor = first.meta?.page?.nextCursor;
    expect(cursor).toBeTruthy();
    const second = envelopeOf<NotificationDto[]>(
      await get(alice, `?limit=1&cursor=${encodeURIComponent(cursor ?? '')}`),
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

  it('SEC-HR-19: thu grant HR của Hana ⇒ thông báo dành cho HR biến khỏi chuông ở request kế tiếp', async () => {
    await miaSubmits();
    expect(await count(hana)).toBe(1);
    await setGrants(hana.id, []);
    expect(await typesOf(hana)).toEqual([]);
    expect(await count(hana)).toBe(0);
    expect(await count(alice)).toBe(1);
    await setGrants(hana.id, ['HR_MANAGE']);
    expect(await count(hana)).toBe(1); // cấp lại ⇒ hiện lại (cùng tư cách)
  });

  it('SEC-HR-18 (Mốc 3.5): rời công ty ⇒ danh sách + số chưa đọc rỗng (phạm vi dựng lại mỗi request)', async () => {
    await miaSubmits();
    t.companyStore.removeMember(hana.id);
    expect((await get(hana)).status).toBe(200);
    expect(await list(hana)).toEqual([]);
    expect(await count(hana)).toBe(0);
  });
});

describe('POST /me/notifications/:id/read · /read-all', () => {
  it('SEC-HR-17: id của người khác ⇒ 404 notification (không đổi trạng thái); của mình ⇒ 204, lặp lại vẫn 204', async () => {
    await miaSubmits();
    const n = (await list(hana)).find((x) => x.type === 'LEAVE_SUBMITTED');
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
    expect((await list(hana)).find((x) => x.id === id)?.readAt).not.toBeNull();
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
