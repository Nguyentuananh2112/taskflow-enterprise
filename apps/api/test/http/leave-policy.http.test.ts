// T-057 qua app thật (InMemory): GET/PUT /leave/policy (thứ tự lỗi 401 → 403 trước validate → 400 → 422/409), số dư
// phân rã, EP-09 (B: đổi hireDate làm phép năm nay âm ⇒ cùng con số với negativeBalances của PUT policy), và
// GET /leave/export.xlsx (2 sheet, không lý do nghỉ, creator TaskFlow). Mốc harness: 01/11/2026 (CN), lịch T2–T7.
import { strFromU8, unzipSync } from 'fflate';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let hana: TestUser; // HR
let mia: TestUser;

const DEFAULTS = {
  annualDays: 12,
  seniorityStepYears: 5,
  seniorityBonusDays: 1,
  carryOverEnabled: false,
  carryOverMaxDays: 0,
  carryOverExpiryMonth: 3,
};
const api = (by: TestUser | null, method: 'get' | 'put' | 'post', path: string, body?: object) => {
  const req = request(t.app)[method](`/api/v1${path}`);
  if (by) req.set(by.auth);
  return body === undefined ? req : req.send(body);
};

beforeEach(async () => {
  t = createTestApp();
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'] });
  mia = await t.register('Mia');
});

describe('/leave/policy', () => {
  it('thứ tự lỗi: 401 → nhân viên 403 kể cả body sai → HR body dưới luật 400 → năm đã qua 422 → lệch version 409', async () => {
    expect((await api(null, 'get', '/leave/policy?year=2026')).status).toBe(401);
    for (const res of [
      await api(mia, 'get', '/leave/policy?year=2026'),
      await api(mia, 'put', '/leave/policy/2026', { annualDays: 5 }),
    ]) {
      expect(res.status).toBe(403);
      expect(errorOf(res).details).toMatchObject({ required: 'hr:manage' });
    }
    for (const bad of [
      { ...DEFAULTS, annualDays: 11, expectedVersion: 0 },
      { ...DEFAULTS, seniorityStepYears: 6, expectedVersion: 0 },
      { ...DEFAULTS, seniorityBonusDays: 0.5, expectedVersion: 0 },
      { ...DEFAULTS, annualDays: 12.25, expectedVersion: 0 },
    ]) {
      expect((await api(hana, 'put', '/leave/policy/2026', bad)).status).toBe(400);
    }
    const locked = await api(hana, 'put', '/leave/policy/2025', {
      ...DEFAULTS,
      expectedVersion: 0,
    });
    expect(locked.status).toBe(422);
    expect(errorOf(locked).details).toMatchObject({ rule: 'POLICY_YEAR_LOCKED' });
    const ok = await api(hana, 'put', '/leave/policy/2026', {
      ...DEFAULTS,
      annualDays: 14,
      expectedVersion: 0,
    });
    expect(ok.status).toBe(200);
    expect(envelopeOf<{ policy: object }>(ok).data?.policy).toMatchObject({
      annualDays: 14,
      source: 'SET',
      version: 1,
    });
    const stale = await api(hana, 'put', '/leave/policy/2026', { ...DEFAULTS, expectedVersion: 0 });
    expect(stale.status).toBe(409);
    expect((await api(hana, 'get', '/leave/policy?year=2027')).body).toMatchObject({
      data: { annualDays: 14, source: 'INHERITED', inheritedFromYear: 2026 },
    });
    const me = await api(mia, 'get', '/leave/balances/me?year=2026');
    expect(envelopeOf(me).data).toMatchObject({ entitledDays: 14, missingHireDate: true });
  });
});

describe('EP-09: phép âm khi đổi hireDate khớp negativeBalances của PUT policy (cùng dữ liệu)', () => {
  it('vào 2010 ⇒ 15 ngày, dùng 15; đổi sang 2024 ⇒ hồ sơ báo −3 năm 2026; PUT policy cùng năm báo Mia −3', async () => {
    const created = await api(hana, 'put', `/hr/employee-profiles/${mia.id}`, {
      hireDate: '2010-01-01',
      expectedVersion: 0,
    });
    expect(created.status, created.text.slice(0, 300)).toBe(200);
    // 02/11 (T2) … 18/11 (T4), T2–T7 ⇒ 6 + 6 + 3 = 15 ngày.
    const sent = await api(mia, 'post', '/leave/requests', {
      type: 'ANNUAL',
      startDate: '2026-11-02',
      endDate: '2026-11-18',
    });
    expect(sent.status, sent.text.slice(0, 300)).toBe(201);
    const leaveId = envelopeOf<{ id: string }>(sent).data?.id;
    expect(
      (
        await api(hana, 'post', `/leave/requests/${String(leaveId)}/approve`, {
          expectedVersion: 1,
        })
      ).status,
    ).toBe(200);

    const changed = await api(hana, 'put', `/hr/employee-profiles/${mia.id}`, {
      hireDate: '2024-01-01',
      expectedVersion: 1,
      reason: 'Nhập nhầm năm vào',
    });
    expect(changed.status, changed.text.slice(0, 300)).toBe(200);
    expect(envelopeOf<{ negativeBalances: unknown }>(changed).data?.negativeBalances).toEqual([
      { year: 2026, remainingDays: -3 },
    ]);
    const policy = await api(hana, 'put', '/leave/policy/2026', {
      ...DEFAULTS,
      expectedVersion: 0,
    });
    expect(envelopeOf<{ negativeBalances: unknown }>(policy).data?.negativeBalances).toEqual([
      {
        userId: mia.id,
        user: expect.objectContaining({ id: mia.id }) as unknown,
        remainingDays: -3,
      },
    ]);
  });
});

describe('/leave/export.xlsx', () => {
  const binary = (req: request.Test) =>
    req.buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  it('HR ⇒ .xlsx 2 sheet (số dư + đơn đã duyệt), không có lý do nghỉ, creator TaskFlow; nhân viên ⇒ 403', async () => {
    const sent = await api(mia, 'post', '/leave/requests', {
      type: 'SICK',
      startDate: '2026-11-03',
      endDate: '2026-11-03',
      reason: 'Khám bệnh BÍ-MẬT-123',
    });
    const leaveId = envelopeOf<{ id: string }>(sent).data?.id;
    await api(hana, 'post', `/leave/requests/${String(leaveId)}/approve`, { expectedVersion: 1 });

    expect((await api(mia, 'get', '/leave/export.xlsx?year=2026')).status).toBe(403);
    const res = await binary(api(hana, 'get', '/leave/export.xlsx?year=2026'));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="nghi-phep-2026.xlsx"');
    const files = Object.fromEntries(
      Object.entries(unzipSync(new Uint8Array(res.body as Buffer))).map(([k, v]) => [
        k,
        strFromU8(v),
      ]),
    );
    expect(files['xl/workbook.xml']).toContain('name="Số dư 2026"');
    expect(files['xl/workbook.xml']).toContain('name="Đơn đã duyệt"');
    expect(files['xl/worksheets/sheet1.xml']).toContain('Mia');
    expect(files['xl/worksheets/sheet2.xml']).toContain('Nghỉ ốm');
    expect(files['docProps/core.xml']).toContain('<dc:creator>TaskFlow</dc:creator>');
    expect(JSON.stringify(files)).not.toContain('BÍ-MẬT-123');
    expect((await api(hana, 'get', '/leave/export.xlsx?year=2026&from=2025-12-01')).status).toBe(
      400,
    );
  });
});
