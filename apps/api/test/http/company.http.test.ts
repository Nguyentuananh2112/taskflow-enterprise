// GET / PATCH /api/v1/company (company-level ADR-133/134/139) qua app thật (InMemory): mọi người thuộc công ty đọc
// tên; chỉ Admin (`company:admin`) đổi, `expectedVersion` (ADR-010), audit COMPANY_RENAMED {name}; thứ tự lỗi 401 →
// 401 SESSION_REVOKED → 403 (trước validate) → 400 → 404 (chưa bootstrap) / 409.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let olivia: TestUser; // Admin
let hana: TestUser; // nhân viên + HR_MANAGE — không có company:admin
let mia: TestUser;

const get = (by: TestUser | null) => {
  const req = request(t.app).get('/api/v1/company');
  return by ? req.set(by.auth) : req;
};
const patch = (by: TestUser, body: object) =>
  request(t.app).patch('/api/v1/company').set(by.auth).send(body);

beforeEach(async () => {
  t = createTestApp();
  olivia = await t.register('Olivia', undefined, { role: 'ADMIN' });
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'] });
  mia = await t.register('Mia');
  await t.persistence.company.company.ensure('Công ty Mẫu', t.clock.now());
});

describe('/company', () => {
  it('nhân viên / Admin đọc tên + version; Admin đổi tên ⇒ version + 1, mọi người thấy tên mới; audit {name}', async () => {
    for (const u of [mia, olivia]) {
      const res = await get(u);
      expect(res.status).toBe(200);
      expect(envelopeOf(res).data).toEqual({
        name: 'Công ty Mẫu',
        version: 1,
        privacyContact: null,
      });
    }
    const renamed = await patch(olivia, { name: '  Công ty Mới  ', expectedVersion: 1 });
    expect(renamed.status).toBe(200);
    expect(envelopeOf(renamed).data).toEqual({
      name: 'Công ty Mới',
      version: 2,
      privacyContact: null,
    });
    expect(envelopeOf(await get(mia)).data).toEqual({
      name: 'Công ty Mới',
      version: 2,
      privacyContact: null,
    });
    const audit = (await t.persistence.company.hrAudit.list({ limit: 10 })).items;
    expect(audit).toEqual([
      expect.objectContaining({
        actorId: olivia.id,
        action: 'COMPANY_RENAMED',
        before: { name: 'Công ty Mẫu' },
        after: { name: 'Công ty Mới' },
      }),
    ]);
  });

  it('T-075: Admin đặt đầu mối quyền riêng tư (giữ tên, KHÔNG audit); chuỗi rỗng ⇒ xóa; > 200 ⇒ 400', async () => {
    const set = await patch(olivia, {
      privacyContact: '  dpo@cty.vn — 0901 234 567 ',
      expectedVersion: 1,
    });
    expect(envelopeOf(set).data).toEqual({
      name: 'Công ty Mẫu',
      version: 2,
      privacyContact: 'dpo@cty.vn — 0901 234 567',
    });
    expect((await t.persistence.company.hrAudit.list({ limit: 10 })).items).toEqual([]);
    const cleared = await patch(olivia, { privacyContact: '', expectedVersion: 2 });
    expect(envelopeOf<{ privacyContact: string | null }>(cleared).data?.privacyContact).toBeNull();
    const long = await patch(olivia, { privacyContact: 'x'.repeat(201), expectedVersion: 3 });
    expect(long.status).toBe(400);
    expect((await patch(olivia, { expectedVersion: 3 })).status).toBe(400);
  });

  it('expectedVersion cũ ⇒ 409 VERSION_CONFLICT kèm bản hiện tại; không ghi audit', async () => {
    await patch(olivia, { name: 'Lần 1', expectedVersion: 1 });
    const stale = await patch(olivia, { name: 'Lần 2', expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(errorOf(stale)).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 2, current: { name: 'Lần 1', version: 2, privacyContact: null } },
    });
    expect((await t.persistence.company.hrAudit.list({ limit: 10 })).items).toHaveLength(1);
  });

  it('thứ tự lỗi: 401 → rời công ty 401 SESSION_REVOKED → HR / nhân viên 403 kể cả body sai → Admin body sai 400', async () => {
    expect((await get(null)).status).toBe(401);
    t.persistence.companyStore!.removeMember(mia.id);
    for (const res of [await get(mia), await patch(mia, { name: 'X', expectedVersion: 1 })]) {
      expect(res.status).toBe(401);
      expect(errorOf(res).code).toBe('SESSION_REVOKED');
    }
    for (const body of [{ name: 'X', expectedVersion: 1 }, { name: '' }]) {
      const res = await patch(hana, body);
      expect(res.status).toBe(403);
      expect(errorOf(res).details).toMatchObject({ required: 'company:admin' });
    }
    for (const body of [
      { name: '   ', expectedVersion: 1 },
      { name: 'x'.repeat(101), expectedVersion: 1 },
      { name: 'X' },
      { name: 'X', expectedVersion: 1, extra: true },
    ]) {
      expect((await patch(olivia, body)).status).toBe(400);
    }
  });

  it('chưa admin:bootstrap (không có dòng companies) ⇒ 404 company cho cả GET lẫn PATCH', async () => {
    t.persistence.companyStore!.setCompany(null);
    for (const res of [await get(mia), await patch(olivia, { name: 'X', expectedVersion: 1 })]) {
      expect(res.status).toBe(404);
      expect(errorOf(res).details).toEqual({ resource: 'company' });
    }
  });
});
