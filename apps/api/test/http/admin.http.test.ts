// T-061a: /api/v1/admin/access qua HTTP thật (in-process) — quyền, thứ tự lỗi, thu hồi phiên, thông báo ACCESS_CHANGED.
import { AccessDto } from '@taskflow/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let olivia: TestUser; // Admin
let ada: TestUser; // Admin thứ hai
let hana: TestUser; // nhân viên + HR_MANAGE
let mia: TestUser; // nhân viên

const access = (path = '') => `/api/v1/admin/access${path}`;
const put = (by: TestUser, userId: string, body: object) =>
  request(t.app)
    .put(access(`/${userId}`))
    .set(by.auth)
    .send(body);

beforeEach(async () => {
  t = createTestApp();
  olivia = await t.register('Olivia', undefined, { role: 'ADMIN', workspace: false });
  ada = await t.register('Ada', undefined, { role: 'ADMIN', workspace: false });
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'], workspace: false });
  mia = await t.register('Mia', undefined, { workspace: false });
});

describe('GET /admin/access', () => {
  it('Admin ⇒ 200 danh sách (email, role, grants, trạng thái), no-store, khớp contract; HR ⇒ 403; chưa đăng nhập ⇒ 401', async () => {
    const res = await request(t.app).get(access()).set(olivia.auth);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const rows = envelopeOf<AccessDto[]>(res).data!;
    expect(rows.every((r) => AccessDto.safeParse(r).success)).toBe(true);
    expect(rows.map((r) => [r.fullName, r.role, r.grants])).toEqual([
      ['Ada', 'ADMIN', []],
      ['Hana', 'EMPLOYEE', ['HR_MANAGE']],
      ['Mia', 'EMPLOYEE', []],
      ['Olivia', 'ADMIN', []],
    ]);
    expect(rows.find((r) => r.fullName === 'Mia')?.email).toBe('mia@example.com');
    const hr = await request(t.app).get(access()).set(hana.auth);
    expect(hr.status).toBe(403);
    expect(errorOf(hr).details).toEqual({ required: 'company:admin' });
    expect((await request(t.app).get(access())).status).toBe(401);
  });
});

describe('PUT /admin/access/:userId', () => {
  it('cấp PAYROLL_MANAGE cho Hana ⇒ 200 version 2; Hana có thông báo ACCESS_CHANGED; phiên của Hana vẫn sống (chỉ đổi grant)', async () => {
    const res = await put(olivia, hana.id, {
      role: 'EMPLOYEE',
      grants: ['HR_MANAGE', 'PAYROLL_MANAGE'],
      expectedVersion: 1,
    });
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toMatchObject({
      grants: ['HR_MANAGE', 'PAYROLL_MANAGE'],
      version: 2,
    });
    const notes = await request(t.app).get('/api/v1/me/notifications').set(hana.auth);
    expect(notes.status).toBe(200);
    expect(
      envelopeOf<{ type: string; refId: string }[]>(notes).data?.map((n) => [n.type, n.refId]),
    ).toEqual([['ACCESS_CHANGED', hana.id]]);
  });

  it('nâng Mia lên Admin ⇒ 200, phiên cũ của Mia bị thu hồi (401), Mia không còn route nhân viên', async () => {
    const res = await put(olivia, mia.id, { role: 'ADMIN', grants: [], expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toMatchObject({ role: 'ADMIN', grants: [] });
    expect((await request(t.app).get('/api/v1/attendance/me/today').set(mia.auth)).status).toBe(
      401,
    );
  });

  it('thứ tự lỗi: HR (không company:grant) gửi body sai ⇒ 403 (không 400); Admin body sai / thừa trường ⇒ 400; tự đổi mình ⇒ 403; lệch version ⇒ 409; không thuộc công ty ⇒ 404 user', async () => {
    const hr = await put(hana, mia.id, { nonsense: true });
    expect(hr.status).toBe(403);
    expect(errorOf(hr).details).toEqual({ required: 'company:grant' });
    for (const body of [
      { role: 'BOSS', grants: [], expectedVersion: 1 },
      { role: 'EMPLOYEE', grants: [], expectedVersion: 1, startDate: '2026-01-01' },
    ]) {
      expect((await put(olivia, mia.id, body)).status).toBe(400);
    }
    expect(
      (await put(olivia, olivia.id, { role: 'EMPLOYEE', grants: [], expectedVersion: 1 })).status,
    ).toBe(403);
    const stale = await put(olivia, hana.id, { role: 'EMPLOYEE', grants: [], expectedVersion: 9 });
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
    const ghost = await put(olivia, '0199e5a2-0000-7000-8000-00000000dead', {
      role: 'EMPLOYEE',
      grants: [],
      expectedVersion: 1,
    });
    expect(ghost.status).toBe(404);
  });

  it('Admin + grants ⇒ 422 GRANT_NOT_ALLOWED; hạ Ada ⇒ 200 EMPLOYEE (vẫn còn Olivia là Admin)', async () => {
    const grant = await put(olivia, ada.id, {
      role: 'ADMIN',
      grants: ['HR_MANAGE'],
      expectedVersion: 1,
    });
    expect(grant.status).toBe(422);
    expect(errorOf(grant).details).toMatchObject({ rule: 'GRANT_NOT_ALLOWED' });
    const demote = await put(olivia, ada.id, { role: 'EMPLOYEE', grants: [], expectedVersion: 1 });
    expect(demote.status).toBe(200);
    expect(envelopeOf(demote).data).toMatchObject({ role: 'EMPLOYEE' });
  });
});
