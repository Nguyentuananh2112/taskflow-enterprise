// GET /api/v1/hr/audit-logs (company-level ADR-136, B-L1, B-H2) qua app thật (InMemory): CHỈ Admin đọc (HR có
// hr:manage cũng 403), thứ tự lỗi 401 → 401 SESSION_REVOKED → 403 (trước validate) → 400; mới nhất trước, keyset
// cursor; actor kèm tên; không bao giờ có `reason` của đơn nghỉ.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let olivia: TestUser; // Admin
let hana: TestUser; // nhân viên + HR_MANAGE
let mia: TestUser;

interface Row {
  id: string;
  action: string;
  actor: { id: string; fullName: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
const logs = (by: TestUser | null, query: Record<string, string | number> = {}) => {
  const req = request(t.app).get('/api/v1/hr/audit-logs').query(query);
  return by ? req.set(by.auth) : req;
};

beforeEach(async () => {
  t = createTestApp();
  olivia = await t.register('Olivia', undefined, { role: 'ADMIN' });
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'] });
  mia = await t.register('Mia');
  await t.consentLeaveReason(hana, mia); // T-075: ca dưới gửi đơn CÓ lý do
  await t.persistence.company.company.ensure('Công ty Mẫu', t.clock.now());
});

describe('GET /hr/audit-logs', () => {
  it('Admin đọc mới nhất trước kèm tên actor; không lộ reason; phân trang bằng cursor', async () => {
    const submitted = await request(t.app)
      .post('/api/v1/leave/requests')
      .set(mia.auth)
      .send({ type: 'SICK', startDate: '2026-11-23', endDate: '2026-11-23', reason: 'sốt cao' });
    expect(submitted.status).toBe(201);
    t.clock.advance(1000);
    const renamed = await request(t.app)
      .patch('/api/v1/company')
      .set(olivia.auth)
      .send({ name: 'Công ty Mới', expectedVersion: 1 });
    expect(renamed.status).toBe(200);

    const res = await logs(olivia);
    expect(res.status).toBe(200);
    const rows = envelopeOf<Row[]>(res).data ?? [];
    expect(rows.map((r) => r.action)).toEqual(['COMPANY_RENAMED', 'LEAVE_SUBMIT']);
    expect(rows[0]).toMatchObject({
      actor: { id: olivia.id, fullName: 'Olivia' },
      before: { name: 'Công ty Mẫu' },
      after: { name: 'Công ty Mới' },
    });
    expect(JSON.stringify(rows)).not.toContain('sốt cao');

    const first = await logs(olivia, { limit: 1 });
    expect(envelopeOf<Row[]>(first).data?.map((r) => r.action)).toEqual(['COMPANY_RENAMED']);
    const cursor = envelopeOf(first).meta?.page?.nextCursor;
    expect(typeof cursor).toBe('string');
    const second = await logs(olivia, { limit: 1, cursor: String(cursor) });
    expect(envelopeOf<Row[]>(second).data?.map((r) => r.action)).toEqual(['LEAVE_SUBMIT']);
    expect(envelopeOf(second).meta?.page).toMatchObject({ hasMore: false });
  });

  it('thứ tự lỗi: 401 → rời công ty 401 SESSION_REVOKED → HR / nhân viên 403 kể cả query sai → Admin query sai 400', async () => {
    expect((await logs(null)).status).toBe(401);
    for (const u of [hana, mia]) {
      for (const query of [{}, { limit: 'abc' }]) {
        const res = await logs(u, query);
        expect(res.status).toBe(403);
        expect(errorOf(res).details).toMatchObject({ required: 'company:admin' });
      }
    }
    for (const query of [{ limit: 0 }, { limit: 101 }, { cursor: 'không-phải-cursor' }]) {
      expect((await logs(olivia, query)).status).toBe(400);
    }
    t.persistence.companyStore!.removeMember(olivia.id);
    const gone = await logs(olivia);
    expect(gone.status).toBe(401);
    expect(errorOf(gone).code).toBe('SESSION_REVOKED');
  });
});
