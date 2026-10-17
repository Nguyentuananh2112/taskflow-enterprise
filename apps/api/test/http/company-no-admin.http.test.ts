// CO-06 vế sau (test-spec-company §2): DB vừa migrate + backfill — mọi người là EMPLOYEE, chưa có Admin, chưa có dòng
// `companies` (chờ `admin:bootstrap`). Route `company:admin` ⇒ 403 (không 500); đọc tên công ty ⇒ 404 company;
// `/auth/me` vẫn chạy với `company.name = null`.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let mia: TestUser;

beforeEach(async () => {
  t = createTestApp();
  mia = await t.register('Mia', undefined, { workspace: false });
});

describe('CO-06: chưa có Admin (sau migration 5, trước bootstrap)', () => {
  it('route company:admin ⇒ 403 FORBIDDEN_ACCESS, không 500', async () => {
    for (const path of [
      '/api/v1/admin/access',
      '/api/v1/admin/workspaces',
      '/api/v1/hr/audit-logs',
    ]) {
      const res = await request(t.app).get(path).set(mia.auth);
      expect([res.status, errorOf(res).code], path).toEqual([403, 'FORBIDDEN_ACCESS']);
    }
  });

  it('chưa có dòng companies ⇒ GET /company 404 company; /auth/me company.name null', async () => {
    const company = await request(t.app).get('/api/v1/company').set(mia.auth);
    expect([company.status, errorOf(company).details]).toEqual([404, { resource: 'company' }]);
    const me = await request(t.app).get('/api/v1/auth/me').set(mia.auth);
    expect(me.status).toBe(200);
    expect(
      envelopeOf<{ company: { name: string | null; role: string } }>(me).data?.company,
    ).toMatchObject({
      name: null,
      role: 'EMPLOYEE',
    });
  });
});
