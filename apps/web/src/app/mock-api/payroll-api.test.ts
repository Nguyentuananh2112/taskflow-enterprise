import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';

// Mock bảng lương (T-050 — payroll.md v4, contract T-048): tạo nháp chỉ khi tháng đã qua, phát hành bị chặn có đủ lý
// do, luật self tuyệt đối, lockVersion, bản điều chỉnh có lý do, nhân viên chỉ thấy bảng đã phát hành, HR ⇒ 403.
// Hôm nay 2026-10-15. Số tiền bịa.

const BASE = 'http://localhost:4000/api/v1';
type Json = {
  data: Record<string, unknown>;
  error?: { code: string; details: Record<string, unknown> };
};

function setup() {
  const api = createMockApi(BASE, { now: () => Date.parse('2026-10-15T03:00:00.000Z') });
  const make = (name: string) =>
    api.db.createUser({ email: `${name}@example.com`, password: 'x', fullName: name }).user;
  const [acc, an, hr] = [make('kim'), make('an'), make('hana')];
  api.db.company.setAccess(acc.id, 'EMPLOYEE', ['PAYROLL_MANAGE']);
  api.db.company.setAccess(hr.id, 'EMPLOYEE', ['HR_MANAGE']);
  const send = async (who: typeof acc, method: string, path: string, body?: unknown) => {
    const response = await getResponse(
      api.handlers,
      new Request(BASE + path, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${api.db.issueAccess(who).accessToken}`,
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
      }),
    );
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    return { status: response.status, body: (await response.json()) as Json };
  };
  return { api, send, acc, an, hr };
}

const line = { section: 'BONUS', label: 'Thưởng kênh online', amount: 1_000_000 };

describe('mock bảng lương (T-050)', () => {
  it('tháng chưa qua ⇒ 422 PERIOD_NOT_ENDED; HR ⇒ 403; tạo nháp idempotent; thiếu hồ sơ ⇒ PUBLISH_BLOCKED đủ lý do', async () => {
    const { send, acc, an, hr } = setup();
    expect((await send(acc, 'POST', '/payroll/runs/2026-10')).body.error?.details).toEqual({
      rule: 'PERIOD_NOT_ENDED',
    });
    expect((await send(hr, 'POST', '/payroll/runs/2026-09')).status).toBe(403);
    expect((await send(acc, 'POST', '/payroll/runs/2026-09')).status).toBe(201);
    expect((await send(acc, 'POST', '/payroll/runs/2026-09')).status).toBe(201);
    const blocked = await send(acc, 'POST', '/payroll/runs/2026-09/publish', { confirmed: true });
    expect(blocked.status).toBe(422);
    const blockers = blocked.body.error?.details.blockers as Array<{
      userId: string;
      reasons: string[];
    }>;
    expect(blockers.find((b) => b.userId === an.id)?.reasons).toEqual([
      'MISSING_SALARY_PROFILE',
      'MISSING_HIRE_DATE',
    ]);
  });

  it('luật self: kế toán sửa phiếu / hồ sơ lương của chính mình ⇒ 403; dòng của mình có own', async () => {
    const { send, acc, an } = setup();
    await send(acc, 'POST', '/payroll/runs/2026-09');
    const body = {
      lines: [],
      note: null,
      overrideHalfDays: null,
      overrideReason: null,
      expectedLockVersion: 1,
    };
    expect((await send(acc, 'PUT', `/payroll/runs/2026-09/payslips/${acc.id}`, body)).status).toBe(
      403,
    );
    expect(
      (
        await send(acc, 'POST', `/payroll/salary-profiles/${acc.id}`, {
          effectiveFrom: '2026-01',
          level: 'L1',
          baseSalary: 1,
        })
      ).status,
    ).toBe(403);
    const run = await send(acc, 'GET', '/payroll/runs/2026-09');
    const rows = run.body.data.payslips as Array<{ user: { id: string }; own: boolean }>;
    expect(rows.find((r) => r.user.id === acc.id)?.own).toBe(true);
    expect(rows.find((r) => r.user.id === an.id)?.own).toBe(false);
  });

  it('PUT phiếu: tổng do computePayslip; lockVersion lệch ⇒ 409; sửa công thiếu lý do ⇒ 400', async () => {
    const { api, send, acc, an } = setup();
    api.payroll.hireDateOf = () => '2020-03-01';
    await send(acc, 'POST', `/payroll/salary-profiles/${an.id}`, {
      effectiveFrom: '2026-01',
      level: 'L2',
      baseSalary: 8_000_000,
    });
    await send(acc, 'POST', '/payroll/runs/2026-09');
    const path = `/payroll/runs/2026-09/payslips/${an.id}`;
    const saved = await send(acc, 'PUT', path, {
      lines: [line],
      note: null,
      overrideHalfDays: 52,
      overrideReason: 'Đi công tác, quên chấm',
      expectedLockVersion: 1,
    });
    expect(saved.status).toBe(200);
    // 26 ngày làm / 26 công chuẩn ⇒ đủ 8 000 000; thâm niên 6 năm × 500 000.
    expect(saved.body.data).toMatchObject({
      salaryByDays: 8_000_000,
      seniorityAllowance: 3_000_000,
      bonusTotal: 1_000_000,
      netPay: 12_000_000,
      lockVersion: 2,
    });
    const stale = {
      lines: [],
      note: null,
      overrideHalfDays: null,
      overrideReason: null,
      expectedLockVersion: 1,
    };
    expect((await send(acc, 'PUT', path, stale)).status).toBe(409);
    expect(
      (await send(acc, 'PUT', path, { ...stale, overrideHalfDays: 40, expectedLockVersion: 2 }))
        .status,
    ).toBe(400);
  });

  it('phát hành ⇒ nhân viên thấy; bản điều chỉnh có lý do ⇒ revision 2, bản 1 supersededAt', async () => {
    const { api, send, acc, an, hr } = setup();
    api.payroll.hireDateOf = () => '2020-03-01';
    // Hồ sơ lương của chính kế toán do người khác nhập (luật self) ⇒ ghi thẳng vào store.
    for (const u of [an, acc, hr]) {
      api.payroll.profiles.set(u.id, [
        {
          id: crypto.randomUUID(),
          effectiveFrom: '2026-01',
          level: 'L1',
          baseSalary: 7_000_000,
          createdBy: { id: acc.id, fullName: 'kim' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
    }
    await send(acc, 'POST', '/payroll/runs/2026-09');
    expect((await send(an, 'GET', '/payslips/2026-09')).status).toBe(404);
    expect(
      (await send(acc, 'POST', '/payroll/runs/2026-09/publish', { confirmed: true })).status,
    ).toBe(200);
    expect((await send(an, 'GET', '/payslips')).body.data).toEqual([
      expect.objectContaining({ period: '2026-09', revision: 1 }),
    ]);
    const revised = await send(acc, 'POST', `/payroll/runs/2026-09/payslips/${an.id}/revisions`, {
      lines: [line],
      note: null,
      overrideHalfDays: null,
      overrideReason: null,
      expectedRevision: 1,
      reason: 'Thiếu thưởng',
    });
    expect(revised.status).toBe(201);
    expect((await send(an, 'GET', '/payslips/2026-09')).body.data).toMatchObject({
      revision: 2,
      revisionReason: 'Thiếu thưởng',
    });
    expect(
      (await send(an, 'GET', '/payslips/2026-09/revisions/1')).body.data.supersededAt,
    ).not.toBeNull();
  });
});
