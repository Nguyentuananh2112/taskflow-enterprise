// member-candidates (company-level ADR-134, SEC-HR-37, R41) qua app thật (InMemory): người thuộc công ty thêm được
// vào ws — Admin và người chờ kích hoạt CÓ, người có lịch nghỉ / đã rời / đã ở ws KHÔNG; thứ tự lỗi 401 → 403 (quyền
// trước validate) → 400 q → 429 (60/giờ/actor); chỉ id + tên + email.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let alice: TestUser; // OWNER ws mặc định
let mia: TestUser; // MEMBER của ws Alice
let wsId: string;

const candidates = (by: TestUser | null, q: string) => {
  const req = request(t.app).get(`/api/v1/workspaces/${wsId}/member-candidates`).query({ q });
  return by ? req.set(by.auth) : req;
};
const names = (res: request.Response) =>
  (envelopeOf<{ fullName: string }[]>(res).data ?? []).map((u) => u.fullName);

beforeEach(async () => {
  t = createTestApp();
  alice = await t.register('Alice');
  wsId = alice.workspaceId;
  mia = await t.register('Mia');
  const added = await request(t.app)
    .post(`/api/v1/workspaces/${wsId}/members`)
    .set(alice.auth)
    .send({ userId: mia.id, role: 'MEMBER' });
  expect(added.status).toBe(201);
});

describe('GET /workspaces/:wsId/member-candidates', () => {
  it('Admin + nhân viên chưa ở ws; không người có lịch nghỉ / đã rời / đã ở ws; sắp theo tên; chỉ id, tên, email', async () => {
    await t.register('Olivia', undefined, { role: 'ADMIN' });
    const bob = await t.register('Bob');
    const eve = await t.register('Eve');
    const gone = await t.register('Gone');
    t.persistence.companyStore!.removeMember(gone.id);
    const row = await t.persistence.companyStore!.find(eve.id);
    t.persistence.companyStore!.upsertMember({
      ...row!,
      offboardLastDay: '2026-11-30',
      offboardAccessUntil: new Date('2026-11-30T23:00:00.000Z'),
      offboardScheduledById: alice.id,
    });
    const res = await candidates(alice, 'EXAMPLE.com');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Bob', 'Olivia']);
    expect(envelopeOf<object[]>(res).data?.[0]).toEqual({
      id: bob.id,
      fullName: 'Bob',
      email: bob.email,
    });
    expect(names(await candidates(alice, 'bo'))).toEqual(['Bob']);
    expect(names(await candidates(alice, '%_'))).toEqual([]);
  });

  it('thứ tự lỗi: 401 → MEMBER 403 kể cả q sai → OWNER q < 2 ký tự 400 → lần 61 trong giờ 429', async () => {
    expect((await candidates(null, 'bo')).status).toBe(401);
    for (const q of ['bo', '']) {
      const res = await candidates(mia, q);
      expect(res.status).toBe(403);
      expect(errorOf(res).details).toMatchObject({ required: 'member:add' });
    }
    expect((await candidates(alice, 'a')).status).toBe(400);
    expect((await candidates(alice, 'x'.repeat(101))).status).toBe(400);
    // 2 lần 400 ở trên đã đếm (hạn mức trước validate) ⇒ còn 58 lần.
    for (let i = 0; i < 58; i += 1) expect((await candidates(alice, 'bo')).status).toBe(200);
    const blocked = await candidates(alice, 'bo');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
