// T-049 (payroll.md v4): route lương qua HTTP thật (in-process) — quyền payroll:manage / payslip:self (403 trước 400),
// luật self, tạo bảng nháp, phát hành bị chặn (PUBLISH_BLOCKED đủ lý do), phiếu của tôi chỉ sau phát hành.
import { PayrollRunDto, PayrollSettingsDto } from '@taskflow/contracts/payroll';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let olivia: TestUser; // Admin — payroll:manage, không có phiếu
let kai: TestUser; // nhân viên + PAYROLL_MANAGE
let mia: TestUser; // nhân viên

const api = (path: string) => `/api/v1${path}`;
const at = (local: string) => t.clock.set(new Date(`${local.replace(' ', 'T')}:00+07:00`));

beforeEach(async () => {
  t = createTestApp();
  at('2026-12-01 10:00');
  const from = { startDate: '2026-11-01' };
  olivia = await t.register('Olivia', undefined, { role: 'ADMIN' });
  kai = await t.register('Kai', undefined, { grants: ['PAYROLL_MANAGE'], ...from });
  mia = await t.register('Mia', undefined, from);
});

describe('quyền', () => {
  it('nhân viên gọi /payroll (body sai) ⇒ 403 trước 400; Admin gọi /payslips ⇒ 403; Kế toán đọc cài đặt ⇒ 200', async () => {
    const bad = await request(t.app).put(api('/payroll/settings')).set(mia.auth).send({ x: 1 });
    expect(bad.status).toBe(403);
    expect((await request(t.app).get(api('/payslips')).set(olivia.auth)).status).toBe(403);
    const ok = await request(t.app).get(api('/payroll/settings')).set(kai.auth);
    expect(ok.status).toBe(200);
    expect(PayrollSettingsDto.parse(envelopeOf(ok).data)).toMatchObject({
      seniorityPerYear: 500_000,
    });
    expect(ok.headers['cache-control']).toBe('no-store');
  });

  it('luật self: Kế toán tạo hồ sơ lương cho chính mình ⇒ 403; cho Mia ⇒ 201; trùng tháng ⇒ 409', async () => {
    const body = { effectiveFrom: '2026-01', level: 'L1', baseSalary: 10_000_000 };
    expect(
      (
        await request(t.app)
          .post(api(`/payroll/salary-profiles/${kai.id}`))
          .set(kai.auth)
          .send(body)
      ).status,
    ).toBe(403);
    const ok = await request(t.app)
      .post(api(`/payroll/salary-profiles/${mia.id}`))
      .set(kai.auth)
      .send(body);
    expect(ok.status).toBe(201);
    expect(
      (
        await request(t.app)
          .post(api(`/payroll/salary-profiles/${mia.id}`))
          .set(olivia.auth)
          .send(body)
      ).status,
    ).toBe(409);
  });
});

describe('bảng lương tháng', () => {
  it('tạo nháp 201 (lặp ⇒ 200); tháng chưa hết ⇒ 422; phát hành thiếu hồ sơ / ngày vào ⇒ 422 PUBLISH_BLOCKED; body publish sai ⇒ 400; phiếu của tôi chưa có (404)', async () => {
    const created = await request(t.app).post(api('/payroll/runs/2026-11')).set(kai.auth).send({});
    expect(created.status, created.text).toBe(201);
    const run = PayrollRunDto.parse(envelopeOf(created).data);
    expect(run.status).toBe('DRAFT');
    expect(run.payslips.map((p) => p.user.id).sort()).toEqual([kai.id, mia.id].sort());
    expect(run.payslips.find((p) => p.user.id === kai.id)?.own).toBe(true);
    expect(
      (await request(t.app).post(api('/payroll/runs/2026-11')).set(olivia.auth).send({})).status,
    ).toBe(200);
    const early = await request(t.app).post(api('/payroll/runs/2026-12')).set(kai.auth).send({});
    expect(errorOf(early)).toMatchObject({ details: { rule: 'PERIOD_NOT_ENDED' } });

    expect(
      (
        await request(t.app)
          .post(api('/payroll/runs/2026-11/publish'))
          .set(kai.auth)
          .send({ confirmed: false })
      ).status,
    ).toBe(400);
    const blocked = await request(t.app)
      .post(api('/payroll/runs/2026-11/publish'))
      .set(kai.auth)
      .send({ confirmed: true });
    expect(blocked.status).toBe(422);
    const details = errorOf(blocked).details as {
      rule: string;
      blockers: { userId: string; reasons: string[] }[];
    };
    expect(details.rule).toBe('PUBLISH_BLOCKED');
    expect(details.blockers.find((b) => b.userId === mia.id)?.reasons).toEqual([
      'MISSING_SALARY_PROFILE',
      'MISSING_HIRE_DATE',
    ]);
    expect((await request(t.app).get(api('/payslips/2026-11')).set(mia.auth)).status).toBe(404);
  });
});
