// T-038: route chấm công qua HTTP thật (in-process) — thứ tự lỗi, Idempotency-Key, hạn mức, CSV, luồng HR.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let olivia: TestUser; // OWNER
let hana: TestUser; // MEMBER + HR_MANAGE
let mia: TestUser; // MEMBER
let vic: TestUser; // VIEWER
let rex: TestUser; // không phải thành viên
let wsId: string;

const att = (path = '') => `/api/v1/workspaces/${wsId}/attendance${path}`;
const key = (n: number) => `0199e5a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const punch = (by: TestUser, kind: 'in' | 'out', k: string) =>
  request(t.app)
    .post(att(`/check-${kind}`))
    .set(by.auth)
    .set('Idempotency-Key', k)
    .send({}); // POST luôn cần Content-Type JSON (chống CSRF — security.md §6.3), kể cả không có body
/** Giờ VN (UTC+7) ⇒ đặt đồng hồ server. */
const at = (local: string) => t.clock.set(new Date(`${local.replace(' ', 'T')}:00+07:00`));

beforeEach(async () => {
  t = createTestApp();
  // Đặt giờ TRƯỚC khi đăng nhập: dời đồng hồ sau đó sẽ làm access token (15 phút) hết hạn.
  at('2026-11-02 07:55'); // thứ Hai
  olivia = await t.register('Olivia');
  wsId = olivia.workspaceId;
  [hana, mia, vic, rex] = [
    await t.register('Hana'),
    await t.register('Mia'),
    await t.register('Vic'),
    await t.register('Rex'),
  ];
  for (const [u, role] of [
    [hana, 'MEMBER'],
    [mia, 'MEMBER'],
    [vic, 'VIEWER'],
  ] as const) {
    const res = await request(t.app)
      .post(`/api/v1/workspaces/${wsId}/members`)
      .set(olivia.auth)
      .send({ email: u.email, role });
    expect(res.status).toBe(201);
  }
  const grant = await request(t.app)
    .put(`/api/v1/workspaces/${wsId}/members/${hana.id}/grants`)
    .set(olivia.auth)
    .send({ grants: ['HR_MANAGE'] });
  expect(grant.status).toBe(200);
});

describe('check-in / check-out', () => {
  it('201 lượt mới; lặp cùng Idempotency-Key ⇒ 200 cùng firstIn; key khác ⇒ 409 already_checked_in; no-store', async () => {
    const first = await punch(mia, 'in', key(1));
    expect(first.status).toBe(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(envelopeOf(first).data).toMatchObject({ status: 'PRESENT', date: '2026-11-02' });
    const again = await punch(mia, 'in', key(1));
    expect(again.status).toBe(200);
    expect(envelopeOf<{ firstIn: string }>(again).data?.firstIn).toBe(
      envelopeOf<{ firstIn: string }>(first).data?.firstIn,
    );
    const second = await punch(mia, 'in', key(2));
    expect(second.status).toBe(409);
    expect(errorOf(second)).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      details: { reason: 'already_checked_in' },
    });
  });

  it('thứ tự lỗi: chưa đăng nhập 401 → không phải thành viên 404 → VIEWER 403 → thiếu / sai Idempotency-Key 400', async () => {
    expect(
      (await request(t.app).post(att('/check-in')).set('Idempotency-Key', key(1)).send({})).status,
    ).toBe(401);
    const outsider = await punch(rex, 'in', key(1));
    expect(outsider.status).toBe(404);
    expect(errorOf(outsider).details).toEqual({ resource: 'workspace' });
    // VIEWER thiếu header vẫn 403 (quyền trước validate).
    const viewer = await request(t.app).post(att('/check-in')).set(vic.auth).send({});
    expect(viewer.status).toBe(403);
    expect(errorOf(viewer)).toMatchObject({ details: { required: 'attendance:self' } });
    for (const header of [undefined, 'not-a-uuid']) {
      const req = request(t.app).post(att('/check-in')).set(mia.auth);
      const res = await (header ? req.set('Idempotency-Key', header) : req).send({});
      expect(res.status).toBe(400);
    }
  });

  it('hạn mức 10/phút/user: lượt thứ 11 ⇒ 429 + Retry-After (người khác không bị ảnh hưởng)', async () => {
    for (let i = 1; i <= 10; i += 1) {
      expect((await punch(mia, 'in', key(1))).status).toBeLessThan(300);
    }
    const blocked = await punch(mia, 'in', key(1));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await punch(hana, 'in', key(1))).status).toBe(201);
  });

  it('me/today, me?month=, me/events: dữ liệu của chính mình, kèm IP / UA', async () => {
    await punch(mia, 'in', key(1)).set('User-Agent', 'TestUA/1');
    const today = await request(t.app).get(att('/me/today')).set(mia.auth);
    expect(today.status).toBe(200);
    expect(envelopeOf(today).data).toMatchObject({
      timezone: 'Asia/Ho_Chi_Minh',
      status: 'PRESENT',
    });
    const month = await request(t.app).get(att('/me?month=2026-11')).set(mia.auth);
    expect(envelopeOf<{ days: unknown[] }>(month).data?.days).toHaveLength(30);
    const events = await request(t.app).get(att('/me/events?date=2026-11-02')).set(mia.auth);
    expect(
      envelopeOf<{ events: { userAgent: string; ip: string | null }[] }>(events).data?.events,
    ).toEqual([expect.objectContaining({ userAgent: 'TestUA/1' })]);
    expect((await request(t.app).get(att('/me?month=2026-13')).set(mia.auth)).status).toBe(400);
  });
});

describe('route HR', () => {
  it('SEC-HR-02: MEMBER gọi route hr:manage (kể cả body sai) ⇒ 403, không 400; HR body sai ⇒ 400', async () => {
    for (const [method, path, body] of [
      ['get', '/today', undefined],
      ['get', '?month=2026-11', undefined],
      ['get', '/export.csv?month=2026-11', undefined],
      ['post', '/events', { nonsense: true }],
      ['post', '/schedules', { nonsense: true }],
      ['put', '/holidays/2026-12-01', { nonsense: true }],
    ] as const) {
      const req = request(t.app)[method](att(path)).set(mia.auth);
      const res = await (body ? req.send(body) : req);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(errorOf(res).details).toEqual({ required: 'hr:manage' });
    }
    const bad = await request(t.app).post(att('/events')).set(hana.auth).send({ nonsense: true });
    expect(bad.status).toBe(400);
  });

  it('ADJUSTMENT 201 → xem lượt (HR) → void 200 → void lần 2 409; Mia thấy lượt trong me/events', async () => {
    const adj = await request(t.app).post(att('/events')).set(hana.auth).send({
      userId: mia.id,
      kind: 'IN',
      date: '2026-11-02',
      time: '08:00',
      reason: 'Quên chấm',
    });
    expect(adj.status).toBe(201);
    const eventId = envelopeOf<{ event: { id: string } }>(adj).data!.event.id;
    const list = await request(t.app)
      .get(att(`/events?userId=${mia.id}&date=2026-11-02`))
      .set(hana.auth);
    expect(envelopeOf<{ events: { id: string; source: string }[] }>(list).data?.events).toEqual([
      expect.objectContaining({ id: eventId, source: 'ADJUSTMENT' }),
    ]);
    const voided = await request(t.app)
      .post(att(`/events/${eventId}/void`))
      .set(hana.auth)
      .send({ reason: 'Nhầm' });
    expect(voided.status).toBe(200);
    const twice = await request(t.app)
      .post(att(`/events/${eventId}/void`))
      .set(hana.auth)
      .send({ reason: 'Nhầm' });
    expect(twice.status).toBe(409);
    const mine = await request(t.app).get(att('/me/events?date=2026-11-02')).set(mia.auth);
    expect(envelopeOf<{ events: { voidReason: string }[] }>(mine).data?.events[0]?.voidReason).toBe(
      'Nhầm',
    );
  });

  it('HR tự điều chỉnh công của mình ⇒ 403; hôm nay + tháng (cursor) cả công ty', async () => {
    const self = await request(t.app).post(att('/events')).set(hana.auth).send({
      userId: hana.id,
      kind: 'IN',
      date: '2026-11-02',
      time: '08:00',
      reason: 'x',
    });
    expect(self.status).toBe(403);
    await punch(mia, 'in', key(1));
    const today = await request(t.app).get(att('/today')).set(hana.auth);
    expect(today.status).toBe(200);
    expect(
      envelopeOf<{ members: { user: { fullName: string } }[] }>(today).data?.members.map(
        (m) => m.user.fullName,
      ),
    ).toEqual(['Hana', 'Mia', 'Olivia']);
    const page1 = await request(t.app).get(att('?month=2026-11&limit=2')).set(hana.auth);
    expect(page1.status).toBe(200);
    const body = envelopeOf<{ user: { fullName: string } }[]>(page1);
    expect(body.data?.map((r) => r.user.fullName)).toEqual(['Hana', 'Mia']);
    expect(body.meta.page).toMatchObject({ hasMore: true, limit: 2 });
    const page2 = await request(t.app)
      .get(att(`?month=2026-11&limit=2&cursor=${body.meta.page!.nextCursor}`))
      .set(hana.auth);
    expect(
      envelopeOf<{ user: { fullName: string } }[]>(page2).data?.map((r) => r.user.fullName),
    ).toEqual(['Olivia']);
    expect((await request(t.app).get(att('?month=2026-11&limit=51')).set(hana.auth)).status).toBe(
      400,
    );
  });

  it('SEC-HR-12: CSV — text/csv + BOM, Content-Disposition theo tháng, no-store, không IP/UA; month lạ ⇒ 400', async () => {
    await punch(mia, 'in', key(1)).set('User-Agent', 'SecretUA/9');
    const res = await request(t.app)
      .get(att('/export.csv?month=2026-11'))
      .set(hana.auth)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (data += c));
        r.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="cham-cong-2026-11.csv"');
    expect(res.headers['cache-control']).toBe('no-store');
    const text = res.body as string;
    expect(text.startsWith('﻿"Họ tên"')).toBe(true);
    expect(text).not.toContain('SecretUA');
    expect(text).toContain('"Mia","","2026-11-02","T2","Có mặt","07:55"');
    for (const month of ['../../x', '2026-1', '2026-11"']) {
      const bad = await request(t.app)
        .get(att(`/export.csv?month=${encodeURIComponent(month)}`))
        .set(hana.auth);
      expect(bad.status).toBe(400);
    }
  });
});

describe('lịch + ngày lễ', () => {
  it('VIEWER đọc lịch / ngày lễ được; ghi cần hr:manage; HR lưu lịch 201, ngày lễ PUT 200 / DELETE 204 (không body)', async () => {
    expect((await request(t.app).get(att('/schedules')).set(vic.auth)).status).toBe(200);
    expect((await request(t.app).get(att('/holidays?year=2026')).set(vic.auth)).status).toBe(200);
    const schedule = {
      effectiveFrom: '2026-11-02',
      timezone: 'Asia/Ho_Chi_Minh',
      workdays: 31,
      startMin: 540,
      endMin: 1080,
      breakStartMin: 720,
      breakEndMin: 780,
      graceMin: 5,
    };
    expect((await request(t.app).post(att('/schedules')).set(mia.auth).send(schedule)).status).toBe(
      403,
    );
    const saved = await request(t.app).post(att('/schedules')).set(hana.auth).send(schedule);
    expect(saved.status).toBe(201);
    expect(envelopeOf(saved).data).toMatchObject({ startMin: 540, createdBy: { id: hana.id } });
    const past = await request(t.app)
      .post(att('/schedules'))
      .set(hana.auth)
      .send({ ...schedule, effectiveFrom: '2026-11-01' });
    expect(errorOf(past)).toMatchObject({ details: { rule: 'SCHEDULE_IN_PAST' } });
    const tz = await request(t.app)
      .post(att('/schedules'))
      .set(hana.auth)
      .send({ ...schedule, timezone: 'Mars/Base' });
    expect(tz.status).toBe(400);
    const put = await request(t.app)
      .put(att('/holidays/2026-12-31'))
      .set(hana.auth)
      .send({ name: 'Cuối năm' });
    expect(put.status).toBe(200);
    const del = await request(t.app).delete(att('/holidays/2026-12-31')).set(hana.auth);
    expect(del.status).toBe(204);
    const list = await request(t.app).get(att('/holidays?year=2026')).set(vic.auth);
    expect(envelopeOf(list).data).toEqual([]);
    expect(
      (await request(t.app).put(att('/holidays/2026-02-30')).set(hana.auth).send({ name: 'x' }))
        .status,
    ).toBe(400);
  });
});
