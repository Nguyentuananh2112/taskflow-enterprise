import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';
import { COMPANY_SCOPE } from './mock-guard';

// Mock đơn bổ sung giờ (T-058b — ADR-129, contract T-056): luật gửi rút gọn trả đúng mã, Idempotency-Key lặp ⇒ đơn cũ,
// đơn chờ trùng ⇒ 409, IDOR ⇒ 404, nhân viên gọi danh sách HR ⇒ 403, tự duyệt ⇒ 403, duyệt ⇒ ADJUSTMENT + PRESENT.
// Hôm nay: 2026-10-15 10:00 (+07). Dữ liệu bịa.

const BASE = 'http://localhost:4000/api/v1';
type Json = {
  data: Record<string, unknown>;
  error?: { code: string; details: Record<string, unknown> };
};

function setup() {
  const api = createMockApi(BASE, { now: () => Date.parse('2026-10-15T03:00:00.000Z') });
  const make = (name: string) => {
    const u = api.db.createUser({
      email: `${name}@example.com`,
      password: 'x',
      fullName: name,
    }).user;
    api.db.company.add(u.id, '2026-09-01T00:00:00+07:00', '2026-09-01');
    return u;
  };
  const [hr, an, binh] = [make('hana'), make('an'), make('binh')];
  api.db.company.setAccess(hr.id, 'EMPLOYEE', ['HR_MANAGE']);
  api.attendance.adjust(COMPANY_SCOPE, an.id, '2026-10-14', {
    kind: 'IN',
    at: Date.parse('2026-10-14T08:00:00+07:00'),
    by: an,
    note: 'seed',
  });
  const send = async (
    who: typeof hr,
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ) => {
    const response = await getResponse(
      api.handlers,
      new Request(BASE + path, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${api.db.issueAccess(who).accessToken}`,
          ...(key ? { 'idempotency-key': key } : {}),
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
      }),
    );
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    return { status: response.status, body: (await response.json()) as Json };
  };
  const submit = (who: typeof hr, body: Record<string, unknown>, key = crypto.randomUUID()) =>
    send(who, 'POST', '/attendance/corrections', body, key);
  return { api, send, submit, hr, an, binh };
}

const OUT = { date: '2026-10-14', kind: 'OUT', time: '17:45', reason: 'Quên bấm Ra' };
const rule = (r: { body: Json }) => r.body.error?.details.rule;

describe('mock đơn bổ sung giờ (T-058b)', () => {
  it('luật gửi: ngoài cửa sổ / tương lai / thứ tự giờ / đã có lượt ⇒ đúng mã 422', async () => {
    const { submit, an } = setup();
    expect(rule(await submit(an, { ...OUT, date: '2026-08-31' }))).toBe(
      'CORRECTION_DATE_OUT_OF_RANGE',
    );
    expect(rule(await submit(an, { ...OUT, date: '2026-10-15', time: '17:00' }))).toBe(
      'CORRECTION_IN_FUTURE',
    );
    expect(rule(await submit(an, { ...OUT, time: '07:00' }))).toBe('CORRECTION_TIME_ORDER');
    expect(rule(await submit(an, { ...OUT, kind: 'IN', time: '08:30' }))).toBe(
      'CORRECTION_EVENT_EXISTS',
    );
  });

  it('Idempotency-Key lặp ⇒ đơn cũ (không thêm); đơn chờ cùng ngày + loại ⇒ 409; thiếu key ⇒ 400', async () => {
    const { api, send, submit, an } = setup();
    const key = crypto.randomUUID();
    const first = await submit(an, OUT, key);
    expect(first.status).toBe(201);
    const again = await submit(an, OUT, key);
    expect(again.body.data.id).toBe(first.body.data.id);
    const dup = await submit(an, OUT);
    expect(dup.status).toBe(409);
    expect(dup.body.error?.details).toEqual({ reason: 'correction_pending_exists' });
    expect((await send(an, 'POST', '/attendance/corrections', OUT)).status).toBe(400);
    expect(api.db.company.row(an.id)).toBeDefined();
  });

  it('IDOR: hủy đơn người khác ⇒ 404; nhân viên gọi danh sách HR ⇒ 403; HR tự duyệt ⇒ 403', async () => {
    const { send, submit, an, binh, hr } = setup();
    const id = String((await submit(an, OUT)).body.data.id);
    expect(
      (await send(binh, 'POST', `/attendance/corrections/${id}/cancel`, { expectedVersion: 1 }))
        .status,
    ).toBe(404);
    expect((await send(binh, 'GET', '/attendance/corrections')).status).toBe(403);
    const mine = await send(binh, 'GET', '/attendance/corrections?mine=1');
    expect(mine.body.data).toEqual([]);
    const own = await submit(hr, { ...OUT, kind: 'IN', time: '08:00' });
    expect(
      (
        await send(hr, 'POST', `/attendance/corrections/${String(own.body.data.id)}/approve`, {
          expectedVersion: 1,
        })
      ).status,
    ).toBe(403);
  });

  it('duyệt ⇒ 1 lượt ADJUSTMENT, ngày thành PRESENT; duyệt lại ⇒ 409 invalid_transition', async () => {
    const { api, send, submit, an, hr } = setup();
    const id = String((await submit(an, OUT)).body.data.id);
    const approved = await send(hr, 'POST', `/attendance/corrections/${id}/approve`, {
      expectedVersion: 1,
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data.event).toMatchObject({ kind: 'OUT', source: 'ADJUSTMENT' });
    expect(api.hr.day(COMPANY_SCOPE, an.id, '2026-10-14').status).toBe('PRESENT');
    const again = await send(hr, 'POST', `/attendance/corrections/${id}/approve`, {
      expectedVersion: 2,
    });
    expect(again.body.error?.details).toEqual({ reason: 'invalid_transition' });
  });
});
