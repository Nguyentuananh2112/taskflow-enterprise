// T-056 (hr-extended ADR-129): route đơn bổ sung giờ qua HTTP thật (in-process) — thứ tự lỗi (403 trước 400), strict body,
// Idempotency-Key, danh sách theo quyền, luồng duyệt tạo lượt ADJUSTMENT, hủy đơn PENDING khi hoàn tất nghỉ việc.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let olivia: TestUser; // Admin
let hana: TestUser; // nhân viên + HR_MANAGE
let mia: TestUser; // nhân viên
let max: TestUser; // nhân viên

const att = (path = '') => `/api/v1/attendance${path}`;
const key = (n: number) => `0199e5a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (local: string) => t.clock.set(new Date(`${local.replace(' ', 'T')}:00+07:00`));
const outBody = { date: '2026-11-02', kind: 'OUT', time: '17:45', reason: 'Quên bấm Ra' };
const submit = (by: TestUser, k: string, body: object = outBody) =>
  request(t.app).post(att('/corrections')).set(by.auth).set('Idempotency-Key', k).send(body);

interface Correction {
  id: string;
  status: string;
  version: number;
  reason?: string | null;
  day: { status: string };
}

beforeEach(async () => {
  t = createTestApp();
  // Đăng nhập SAU khi đặt giờ (access token 15 phút). Nhiệm kỳ từ 01/11; Mia vào 08:00 thứ Hai 02/11 (HR thêm tay),
  // quên bấm Ra ⇒ MISSING_OUT; 10:00 hôm sau mở đơn.
  at('2026-11-03 10:00');
  const from = { startDate: '2026-11-01' };
  olivia = await t.register('Olivia', undefined, { role: 'ADMIN' });
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'], ...from });
  [mia, max] = [await t.register('Mia', undefined, from), await t.register('Max', undefined, from)];
  const seeded = await request(t.app).post(att('/events')).set(hana.auth).send({
    userId: mia.id,
    kind: 'IN',
    date: '2026-11-02',
    time: '08:00',
    reason: 'Dữ liệu test',
  });
  expect(seeded.status, seeded.text).toBe(201);
});

describe('POST attendance/corrections', () => {
  it('201 đơn mới (no-store, ô ngày MISSING_OUT); lặp cùng Idempotency-Key ⇒ 200 cùng đơn', async () => {
    const first = await submit(mia, key(1));
    expect(first.status).toBe(201);
    expect(first.headers['cache-control']).toBe('no-store');
    const dto = envelopeOf<Correction>(first).data!;
    expect(dto).toMatchObject({
      status: 'PENDING',
      reason: 'Quên bấm Ra',
      day: { status: 'MISSING_OUT' },
    });
    const again = await submit(mia, key(1));
    expect(again.status).toBe(200);
    expect(envelopeOf<Correction>(again).data?.id).toBe(dto.id);
  });

  it('thứ tự lỗi: Admin (không attendance:self) body sai vẫn 403 → thiếu Idempotency-Key 400 → body strict (userId) 400 → luật 422', async () => {
    const admin = await request(t.app).post(att('/corrections')).set(olivia.auth).send({ x: 1 });
    expect(admin.status).toBe(403);
    expect(
      (await request(t.app).post(att('/corrections')).set(mia.auth).send(outBody)).status,
    ).toBe(400);
    const strict = await submit(mia, key(2), { ...outBody, userId: max.id });
    expect(strict.status).toBe(400);
    const nextDay = await submit(mia, key(3), { ...outBody, time: '07:00', nextDay: true });
    expect(nextDay.status).toBe(400);
    const rule = await submit(mia, key(4), { ...outBody, kind: 'IN', time: '07:30' });
    expect(rule.status).toBe(422);
    expect(errorOf(rule)).toMatchObject({ details: { rule: 'CORRECTION_EVENT_EXISTS' } });
  });

  it('409 correction_pending_exists cho đơn chờ thứ hai cùng ngày + loại', async () => {
    expect((await submit(mia, key(1))).status).toBe(201);
    const dup = await submit(mia, key(2), { ...outBody, time: '18:00' });
    expect(dup.status).toBe(409);
    expect(errorOf(dup)).toMatchObject({ details: { reason: 'correction_pending_exists' } });
  });
});

describe('GET attendance/corrections', () => {
  it('mine=1 (nhân viên) chỉ đơn của mình; không mine ⇒ hr:manage (nhân viên 403, HR thấy cả công ty, có lý do)', async () => {
    const own = envelopeOf<Correction>(await submit(mia, key(1))).data!;
    const mine = await request(t.app).get(att('/corrections?mine=1')).set(mia.auth);
    expect(mine.status).toBe(200);
    expect(envelopeOf<Correction[]>(mine).data?.map((c) => c.id)).toEqual([own.id]);
    expect((await request(t.app).get(att('/corrections')).set(mia.auth)).status).toBe(403);
    expect((await request(t.app).get(att('/corrections?mine=1')).set(olivia.auth)).status).toBe(
      403,
    );
    const hr = await request(t.app).get(att('/corrections?status=PENDING')).set(hana.auth);
    expect(hr.status).toBe(200);
    expect(envelopeOf<Correction[]>(hr).data).toEqual([
      expect.objectContaining({ id: own.id, reason: 'Quên bấm Ra' }),
    ]);
  });
});

describe('cancel / approve / reject', () => {
  it('HR duyệt ⇒ 200 { request APPROVED, event ADJUSTMENT, day PRESENT, totals }; nhân viên gọi approve ⇒ 403', async () => {
    const dto = envelopeOf<Correction>(await submit(mia, key(1))).data!;
    expect(
      (
        await request(t.app)
          .post(att(`/corrections/${dto.id}/approve`))
          .set(max.auth)
          .send({ x: 1 })
      ).status,
    ).toBe(403);
    const res = await request(t.app)
      .post(att(`/corrections/${dto.id}/approve`))
      .set(hana.auth)
      .send({ expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toMatchObject({
      request: { status: 'APPROVED', version: 2 },
      event: { source: 'ADJUSTMENT', kind: 'OUT', workDate: '2026-11-02' },
      day: { status: 'PRESENT' },
    });
  });

  it('người khác hủy ⇒ 404; người gửi hủy ⇒ 200 CANCELLED; từ chối sau đó ⇒ 409 invalid_transition', async () => {
    const dto = envelopeOf<Correction>(await submit(mia, key(1))).data!;
    const path = att(`/corrections/${dto.id}/cancel`);
    expect(
      (await request(t.app).post(path).set(max.auth).send({ expectedVersion: 1 })).status,
    ).toBe(404);
    const ok = await request(t.app).post(path).set(mia.auth).send({ expectedVersion: 1 });
    expect(envelopeOf<Correction>(ok).data).toMatchObject({ status: 'CANCELLED', version: 2 });
    const late = await request(t.app)
      .post(att(`/corrections/${dto.id}/reject`))
      .set(hana.auth)
      .send({ expectedVersion: 2 });
    expect(late.status).toBe(409);
    expect(errorOf(late)).toMatchObject({ details: { reason: 'invalid_transition' } });
  });

  it('CR-14 hoàn tất nghỉ việc (ngày cuối hôm qua) ⇒ đơn PENDING của người đó ⇒ CANCELLED', async () => {
    const dto = envelopeOf<Correction>(await submit(mia, key(1))).data!;
    const off = await request(t.app)
      .put(`/api/v1/hr/employees/${mia.id}/offboarding`)
      .set(hana.auth)
      .send({ lastDay: '2026-11-02' });
    expect(off.status, off.text).toBe(200);
    const list = await request(t.app).get(att('/corrections')).set(hana.auth);
    expect(envelopeOf<Correction[]>(list).data?.find((c) => c.id === dto.id)).toMatchObject({
      status: 'CANCELLED',
    });
  });
});
