// T-037: `PUT members/:userId/grants` + `GET hr-audit-logs` (ADR-119, test-spec-hr GR-*, B-L1 / B-M2).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let alice: TestUser; // OWNER workspace A
let hana: TestUser; // MEMBER của A — được cấp HR_MANAGE
let pam: TestUser; // PM của A
let vic: TestUser; // VIEWER của A
let wsId: string;

const ws = (path = '') => `/api/v1/workspaces${path}`;
const grants = (u: TestUser) => ws(`/${wsId}/members/${u.id}/grants`);
const put = (by: TestUser, path: string, body: object) =>
  request(t.app).put(path).set(by.auth).send(body);
const get = (by: TestUser, path: string) => request(t.app).get(path).set(by.auth);

beforeEach(async () => {
  t = createTestApp();
  alice = await t.register('Alice');
  wsId = alice.workspaceId;
  [hana, pam, vic] = [await t.register('Hana'), await t.register('Pam'), await t.register('Vic')];
  for (const [u, role] of [
    [hana, 'MEMBER'],
    [pam, 'PM'],
    [vic, 'VIEWER'],
  ] as const) {
    const res = await request(t.app)
      .post(ws(`/${wsId}/members`))
      .set(alice.auth)
      .send({ email: u.email, role });
    expect(res.status).toBe(201);
  }
});

describe('PUT /workspaces/:wsId/members/:userId/grants', () => {
  it('OWNER cấp HR_MANAGE ⇒ 200 MemberDto.grants; Hana thấy myGrants ở GET /workspaces', async () => {
    const res = await put(alice, grants(hana), { grants: ['HR_MANAGE'] });
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toMatchObject({
      userId: hana.id,
      role: 'MEMBER',
      grants: ['HR_MANAGE'],
    });
    const mine = envelopeOf<{ id: string; myGrants: string[] }[]>(await get(hana, ws())).data;
    expect(mine?.find((w) => w.id === wsId)).toMatchObject({
      myRole: 'MEMBER',
      myGrants: ['HR_MANAGE'],
    });
    const members = envelopeOf<{ userId: string; grants: string[] }[]>(
      await get(alice, ws(`/${wsId}/members`)),
    ).data;
    expect(members?.find((m) => m.userId === hana.id)?.grants).toEqual(['HR_MANAGE']);
  });

  it('GR-05/06: HR có grant / PM gọi ⇒ 403 FORBIDDEN_ACCESS required=hr:grant', async () => {
    await put(alice, grants(hana), { grants: ['HR_MANAGE'] });
    for (const by of [hana, pam]) {
      const res = await put(by, grants(vic), { grants: [] });
      expect(res.status).toBe(403);
      expect(errorOf(res)).toMatchObject({
        code: 'FORBIDDEN_ACCESS',
        details: { required: 'hr:grant' },
      });
    }
  });

  it('GR-07/08: target VIEWER / OWNER ⇒ 422 GRANT_NOT_ALLOWED', async () => {
    for (const target of [vic, alice]) {
      const res = await put(alice, grants(target), { grants: ['HR_MANAGE'] });
      expect(res.status).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        details: { rule: 'GRANT_NOT_ALLOWED' },
      });
    }
  });

  it('body sai (grant lạ / thiếu / field lạ) ⇒ 400; user không thuộc ws ⇒ 404', async () => {
    for (const body of [{ grants: ['ROOT'] }, {}, { grants: [], role: 'OWNER' }]) {
      expect((await put(alice, grants(hana), body)).status, JSON.stringify(body)).toBe(400);
    }
    const outsider = await t.register('Nina');
    const res = await put(alice, grants(outsider), { grants: ['HR_MANAGE'] });
    expect(res.status).toBe(404);
  });

  it('GR-09 (HTTP): hạ Hana sang VIEWER ⇒ grants về [] trong response PATCH', async () => {
    await put(alice, grants(hana), { grants: ['HR_MANAGE'] });
    const res = await request(t.app)
      .patch(ws(`/${wsId}/members/${hana.id}`))
      .set(alice.auth)
      .send({ role: 'VIEWER' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(envelopeOf(res).data)).toContain('"grants":[]');
  });
});

describe('GET /workspaces/:wsId/hr-audit-logs (B-L1: chỉ OWNER)', () => {
  it('OWNER ⇒ 200 mới nhất trước, có actor + phân trang cursor; HR có grant ⇒ 403', async () => {
    await put(alice, grants(hana), { grants: ['HR_MANAGE'] });
    await put(alice, grants(pam), { grants: ['HR_MANAGE'] });
    const page1 = await get(alice, ws(`/${wsId}/hr-audit-logs?limit=1`));
    expect(page1.status).toBe(200);
    const body =
      envelopeOf<{ action: string; targetUserId: string; actor: { id: string } }[]>(page1);
    expect(body.data).toEqual([
      expect.objectContaining({
        action: 'GRANT',
        targetUserId: pam.id,
      }),
    ]);
    expect(body.data?.[0]?.actor.id).toBe(alice.id);
    const cursor = body.meta.page?.nextCursor ?? '';
    expect(cursor).not.toBe('');
    const page2 = await get(alice, ws(`/${wsId}/hr-audit-logs?limit=1&cursor=${cursor}`));
    expect(envelopeOf<{ targetUserId: string }[]>(page2).data?.map((r) => r.targetUserId)).toEqual([
      hana.id,
    ]);

    const denied = await get(hana, ws(`/${wsId}/hr-audit-logs`));
    expect(denied.status).toBe(403);
    expect(errorOf(denied)).toMatchObject({ details: { required: 'hr:grant' } });
  });

  it('cursor của route khác ⇒ 400; limit > 100 ⇒ 400', async () => {
    expect((await get(alice, ws(`/${wsId}/hr-audit-logs?limit=101`))).status).toBe(400);
    expect((await get(alice, ws(`/${wsId}/hr-audit-logs?cursor=xyz`))).status).toBe(400);
  });
});
