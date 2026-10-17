// TEST_CLOCK_ANCHOR qua composition root thật: giờ NGHIỆP VỤ (attendance / workspace / notifications / leave) neo vào
// mốc rồi trôi; auth/JWT và meta.timestamp vẫn giờ thật (F: E2E-HR-01 không còn đỏ sau 17:30 / Chủ nhật).
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { envelopeOf } from '../support/http';
import { createTestApp, NOW } from '../support/http-app';

// Giờ thật giả lập NOW = 2026-11-01T00:00Z = Chủ nhật 07:00 VN (ngày nghỉ của lịch mặc định).
// Mốc = thứ Ba 03/11 10:00 VN (ngày làm, trong ca).
const ANCHOR = '2026-11-03T10:00:00+07:00';
const key = (n: number) => `0199e5a2-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('giờ nghiệp vụ neo (TEST_CLOCK_ANCHOR)', () => {
  it('me/today + check-in theo MỐC (thứ Ba trong ca ⇒ PRESENT, đang làm), dù giờ thật là Chủ nhật', async () => {
    const t = createTestApp({}, { businessAnchor: ANCHOR });
    const mia = await t.register('Mia');
    const att = (path: string) => `/api/v1/attendance${path}`;

    const today = await request(t.app).get(att('/me/today')).set(mia.auth);
    expect(today.status).toBe(200);
    expect(envelopeOf(today).data).toMatchObject({
      serverNow: '2026-11-03T03:00:00.000Z',
      date: '2026-11-03',
      isWorkday: true,
      status: 'PENDING',
    });
    // meta.timestamp của envelope (thành công lẫn lỗi) cũng theo giờ nghiệp vụ — web tính độ lệch từ đó (E).
    expect(envelopeOf(today).meta.timestamp).toBe('2026-11-03T03:00:00.000Z');
    const notFound = await request(t.app).get('/api/v1/workspaces/not-a-uuid').set(mia.auth);
    expect(notFound.status).toBe(400);
    expect(envelopeOf(notFound).meta.timestamp).toBe('2026-11-03T03:00:00.000Z');

    const card = await request(t.app)
      .post(att('/check-in'))
      .set(mia.auth)
      .set('Idempotency-Key', key(1))
      .send({});
    expect(card.status).toBe(201);
    expect(envelopeOf(card).data).toMatchObject({
      status: 'PRESENT',
      inProgress: true,
      firstIn: '2026-11-03T03:00:00.000Z',
    });
  });

  it('NEO + TRÔI: giờ thật chạy 90 s ⇒ serverNow chạy đúng 90 s; nhân viên vừa đăng ký không bị NOT_EMPLOYED (joinedAt theo mốc)', async () => {
    const t = createTestApp({}, { businessAnchor: ANCHOR });
    const mia = await t.register('Mia');
    t.clock.advance(90_000);
    const res = await request(t.app).get('/api/v1/attendance/me/today').set(mia.auth);
    expect(envelopeOf<{ serverNow: string; status: string }>(res).data).toMatchObject({
      serverNow: '2026-11-03T03:01:30.000Z',
      status: 'PENDING',
    });
  });

  it('mốc TRƯỚC giờ thật (thứ Ba 27/10): workspace cũng theo giờ nghiệp vụ ⇒ joinedAt = mốc ⇒ hôm nay KHÔNG NOT_EMPLOYED', async () => {
    const t = createTestApp({}, { businessAnchor: '2026-10-27T10:00:00+07:00' });
    const mia = await t.register('Mia');
    const res = await request(t.app).get('/api/v1/attendance/me/today').set(mia.auth);
    expect(envelopeOf(res).data).toMatchObject({ date: '2026-10-27', status: 'PENDING' });
  });

  it('auth/JWT KHÔNG bị dịch: token ký theo giờ THẬT (iat = NOW, exp = NOW + 900 s), không theo mốc', async () => {
    const t = createTestApp({}, { businessAnchor: ANCHOR });
    const mia = await t.register('Mia');
    const payload = JSON.parse(Buffer.from(mia.token.split('.')[1]!, 'base64url').toString()) as {
      iat: number;
      exp: number;
    };
    const nowSec = Date.parse(NOW) / 1000;
    expect(payload).toMatchObject({ iat: nowSec, exp: nowSec + 900 });
    expect(payload.iat).not.toBe(Date.parse(ANCHOR) / 1000);
  });

  it('không đặt mốc ⇒ giờ nghiệp vụ = giờ thật (Chủ nhật ⇒ OFF)', async () => {
    const t = createTestApp();
    const mia = await t.register('Mia');
    const res = await request(t.app).get('/api/v1/attendance/me/today').set(mia.auth);
    expect(envelopeOf(res).data).toMatchObject({
      serverNow: NOW,
      date: '2026-11-01',
      isWorkday: false,
      status: 'OFF',
    });
  });
});
