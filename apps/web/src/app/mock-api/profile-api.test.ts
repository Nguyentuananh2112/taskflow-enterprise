import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';

// Mock hồ sơ nhân viên (T-058a — hr-extended.md ADR-128, contract T-054) khó tính như API thật: `me` / `departments`
// không bị `:userId` bắt, luật self tuyệt đối, Admin chưa từng là nhân viên ⇒ 404, version 0 khi tạo, đổi ngày vào đã
// có cần lý do, `null` xóa / bỏ qua giữ nguyên, SĐT chuẩn hóa. Dữ liệu bịa.

const BASE = 'http://localhost:4000/api/v1';

type Json = {
  data: Record<string, unknown>;
  error?: { code: string; details: Record<string, unknown> };
};

function setup() {
  const api = createMockApi(BASE, { now: () => Date.parse('2026-10-15T03:00:00.000Z') });
  const send = async (method: string, path: string, token: string, body?: unknown) => {
    const response = await getResponse(
      api.handlers,
      new Request(BASE + path, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
      }),
    );
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    return { status: response.status, body: (await response.json()) as Json };
  };
  const make = (name: string) =>
    api.db.createUser({
      email: `${name}@example.com`,
      password: 'cay-tre-xanh-ven-song',
      fullName: name,
    }).user;
  const [admin, hr, mia] = [make('olivia'), make('hana'), make('mia')];
  api.db.company.setAccess(admin.id, 'ADMIN');
  api.db.company.setAccess(hr.id, 'EMPLOYEE', ['HR_MANAGE']);
  const token = (u: typeof admin) => api.db.issueAccess(u).accessToken;
  return { api, send, admin, hr, mia, asAdmin: token(admin), asHr: token(hr), asMia: token(mia) };
}

describe('mock hồ sơ nhân viên (T-058a)', () => {
  it('route: /me và /departments khai báo trước /:userId; Admin gọi /me ⇒ 403', async () => {
    const { send, asMia, asHr, asAdmin } = setup();
    const me = await send('GET', '/hr/employee-profiles/me', asMia);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ fullName: 'mia', version: 0, missingHireDate: true });
    expect((await send('GET', '/hr/employee-profiles/departments', asHr)).status).toBe(200);
    expect((await send('GET', '/hr/employee-profiles/me', asAdmin)).status).toBe(403);
  });

  it('nhân viên thường không đọc hồ sơ người khác (403 trước 400); Admin chưa từng là nhân viên ⇒ 404', async () => {
    const { send, admin, mia, hr, asMia, asHr } = setup();
    expect((await send('GET', `/hr/employee-profiles/${hr.id}`, asMia)).status).toBe(403);
    expect((await send('PUT', `/hr/employee-profiles/${hr.id}`, asMia, { x: 1 })).status).toBe(403);
    const r = await send('GET', `/hr/employee-profiles/${admin.id}`, asHr);
    expect(r.status).toBe(404);
    expect(r.body.error?.details).toEqual({ resource: 'user' });
    expect((await send('GET', `/hr/employee-profiles/${mia.id}`, asHr)).status).toBe(200);
  });

  it('PUT: tạo bằng version 0, SĐT chuẩn hóa; lệch version ⇒ 409; body lạ ⇒ 400; HR sửa chính mình ⇒ 403', async () => {
    const { send, mia, hr, asHr, asAdmin } = setup();
    const path = `/hr/employee-profiles/${mia.id}`;
    const created = await send('PUT', path, asHr, {
      hireDate: '2019-03-01',
      workPhone: '(028) 3822-1234',
      expectedVersion: 0,
    });
    expect(created.status).toBe(200);
    expect(created.body.data.profile).toMatchObject({
      workPhone: '02838221234',
      version: 1,
      seniority: { years: 7, months: 7 },
    });
    expect((await send('PUT', path, asHr, { department: 'Kho', expectedVersion: 0 })).status).toBe(
      409,
    );
    expect((await send('PUT', path, asHr, { userId: mia.id, expectedVersion: 1 })).status).toBe(
      400,
    );
    expect(
      (await send('PUT', `/hr/employee-profiles/${hr.id}`, asHr, { expectedVersion: 0 })).status,
    ).toBe(403);
    expect(
      (await send('PUT', `/hr/employee-profiles/${hr.id}`, asAdmin, { expectedVersion: 0 })).status,
    ).toBe(200);
  });

  it('đổi ngày vào đã có thiếu lý do ⇒ 422 REASON_REQUIRED; null xóa, bỏ qua giữ nguyên', async () => {
    const { send, mia, asHr } = setup();
    const path = `/hr/employee-profiles/${mia.id}`;
    await send('PUT', path, asHr, {
      hireDate: '2019-03-01',
      department: 'Kho',
      expectedVersion: 0,
    });
    const noReason = await send('PUT', path, asHr, { hireDate: '2019-04-01', expectedVersion: 1 });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error?.details).toEqual({ rule: 'REASON_REQUIRED' });
    const ok = await send('PUT', path, asHr, {
      hireDate: '2019-04-01',
      department: null,
      expectedVersion: 1,
      reason: 'Nhập nhầm tháng',
    });
    expect(ok.body.data.profile).toMatchObject({
      hireDate: '2019-04-01',
      department: null,
      version: 2,
    });
  });

  it('POST hr/employees kèm hồ sơ ⇒ ghi cùng lúc; nhận lại keepHireDate giữ ngày cũ', async () => {
    const { api, send, mia, asAdmin } = setup();
    const hired = await send('POST', '/hr/employees', asAdmin, {
      email: 'nina@example.com',
      fullName: 'Nina',
      jobTitle: 'Thủ kho',
    });
    const ninaId = (hired.body.data.employee as { userId: string }).userId;
    expect(api.db.company.profiles.get(ninaId)).toMatchObject({
      jobTitle: 'Thủ kho',
      hireDate: null,
    });

    api.db.company.profiles.set(mia.id, { hireDate: '2019-03-01' });
    api.db.company.remove(mia.id);
    await send('POST', '/hr/employees', asAdmin, {
      email: 'mia@example.com',
      fullName: 'mia',
      keepHireDate: true,
      department: 'Kho',
    });
    expect(api.db.company.profiles.get(mia.id)).toMatchObject({
      hireDate: '2019-03-01',
      department: 'Kho',
    });
    const list = await send('GET', '/hr/employees', asAdmin);
    const row = (list.body.data as unknown as Array<Record<string, unknown>>).find(
      (e) => e.userId === mia.id,
    );
    expect(row).toMatchObject({ department: 'Kho', missingHireDate: false });
    expect(row).not.toHaveProperty('workPhone');
  });
});
