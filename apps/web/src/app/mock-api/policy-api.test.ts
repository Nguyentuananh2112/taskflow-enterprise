import { LEAVE_POLICY_DEFAULTS } from '@taskflow/contracts/leave';
import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';

// Mock chính sách phép + xuất Excel (T-058c — ADR-130/131, contract D T-057 / A T-056): kế thừa / mức luật, năm đã qua
// khóa, version, nhân viên thường 403 trước 400, tháng chưa bắt đầu 422, khoảng ngày vắt năm 400. Hôm nay 2026-10-15.

const BASE = 'http://localhost:4000/api/v1';

function setup() {
  const api = createMockApi(BASE, { now: () => Date.parse('2026-10-15T03:00:00.000Z') });
  const make = (name: string) =>
    api.db.createUser({ email: `${name}@example.com`, password: 'x', fullName: name }).user;
  const [hr, an] = [make('hana'), make('an')];
  api.db.company.setAccess(hr.id, 'EMPLOYEE', ['HR_MANAGE']);
  const send = async (who: typeof hr, method: string, path: string, body?: unknown) => {
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
    return response;
  };
  const json = async (r: Response) =>
    (await r.json()) as {
      data: Record<string, unknown>;
      error?: { code: string; details: Record<string, unknown> };
    };
  return { send, json, hr, an };
}

const put = (version: number, over: object = {}) => ({
  ...LEAVE_POLICY_DEFAULTS,
  expectedVersion: version,
  ...over,
});

describe('mock chính sách phép + xuất Excel (T-058c)', () => {
  it('GET: mức luật ⇒ DEFAULT; PUT năm nay ⇒ SET, năm sau kế thừa; năm đã qua ⇒ 422; lệch version ⇒ 409', async () => {
    const { send, json, hr } = setup();
    expect((await json(await send(hr, 'GET', '/leave/policy?year=2026'))).data).toMatchObject({
      source: 'DEFAULT',
      version: 0,
      editable: true,
    });
    const saved = await json(
      await send(hr, 'PUT', '/leave/policy/2026', put(0, { annualDays: 13 })),
    );
    expect(saved.data.policy).toMatchObject({ source: 'SET', version: 1, annualDays: 13 });
    expect((await json(await send(hr, 'GET', '/leave/policy?year=2027'))).data).toMatchObject({
      source: 'INHERITED',
      inheritedFromYear: 2026,
      annualDays: 13,
    });
    const locked = await json(await send(hr, 'PUT', '/leave/policy/2025', put(0)));
    expect(locked.error?.details).toEqual({ rule: 'POLICY_YEAR_LOCKED' });
    expect((await send(hr, 'PUT', '/leave/policy/2026', put(0))).status).toBe(409);
    expect((await send(hr, 'PUT', '/leave/policy/2026', put(1, { annualDays: 11 }))).status).toBe(
      400,
    );
  });

  it('nhân viên thường ⇒ 403 kể cả body sai; export: tháng chưa bắt đầu ⇒ 422, vắt năm ⇒ 400, đúng ⇒ file .xlsx', async () => {
    const { send, json, hr, an } = setup();
    expect((await send(an, 'PUT', '/leave/policy/2026', { bogus: 1 })).status).toBe(403);
    expect((await send(an, 'GET', '/attendance/export.xlsx?month=2026-10')).status).toBe(403);
    const future = await json(await send(hr, 'GET', '/attendance/export.xlsx?month=2026-11'));
    expect(future.error?.details).toEqual({ rule: 'PERIOD_NOT_STARTED' });
    expect((await send(hr, 'GET', '/leave/export.xlsx?year=2026&from=2025-12-31')).status).toBe(
      400,
    );
    const file = await send(hr, 'GET', '/attendance/export.xlsx?month=2026-10');
    expect(file.headers.get('content-disposition')).toBe(
      'attachment; filename="bang-cong-2026-10.xlsx"',
    );
    expect(file.headers.get('cache-control')).toBe('no-store');
  });
});
