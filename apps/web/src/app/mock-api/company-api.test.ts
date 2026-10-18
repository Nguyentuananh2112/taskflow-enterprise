import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';

// Mock Mốc 3.5 (T-065b) phải khó tính như API thật sẽ làm (company-level.md v2.1 ADR-134/137): token kích hoạt chỉ
// một lần, `inspect` không tiêu token, mật khẩu yếu giữ token sống, tạo lại link thu hồi link cũ, nhận lại người đã
// nghỉ, HR không cho chính mình nghỉ, luôn còn ≥ 1 Admin, giao OWNER chỉ cho thành viên còn lại.

const BASE = 'http://localhost:4000/api/v1';
const ORIGIN = 'http://localhost:3000';
const PW = 'cay-tre-xanh-ven-song';

type Json = {
  data: Record<string, unknown>;
  error?: { code: string; details: Record<string, unknown> };
};

function setup() {
  const api = createMockApi(BASE, { now: () => Date.parse('2026-10-15T03:00:00.000Z') });
  const send = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await getResponse(
      api.handlers,
      new Request(BASE + path, {
        method,
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
      }),
    );
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: (text ? JSON.parse(text) : null) as Json,
    };
  };
  const { user: admin } = api.db.createUser({
    email: 'olivia@example.com',
    password: PW,
    fullName: 'Olivia',
  });
  api.db.company.setAccess(admin.id, 'ADMIN');
  const adminToken = api.db.issueAccess(admin).accessToken;
  const hire = (email: string, fullName: string, startDate?: string) =>
    send('POST', '/hr/employees', adminToken, {
      email,
      fullName,
      ...(startDate ? { startDate } : {}),
    });
  return { api, send, admin, adminToken, hire };
}

const activation = (r: { body: Json }) =>
  r.body.data.activation as { token: string; link: string; expiresAt: string } | null;

describe('mock nhân viên + kích hoạt', () => {
  it('thêm ⇒ 201 no-store, link #t=; inspect 2 lần không tiêu token; mật khẩu yếu 400 token vẫn sống; kích hoạt ⇒ phiên; dùng lại ⇒ 410', async () => {
    const { send, hire } = setup();
    const res = await hire('nina@example.com', 'Nina');
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const act = activation(res);
    expect(act?.link).toBe(`${ORIGIN}/activate#t=${act?.token}`);
    const token = act?.token ?? '';
    for (let i = 0; i < 2; i++) {
      const seen = await send('POST', '/auth/activation/inspect', undefined, { token });
      expect(seen.body.data).toEqual({
        fullName: 'Nina',
        email: 'nina@example.com',
        companyName: 'Công ty Mẫu',
      });
    }
    const login = await send('POST', '/auth/login', undefined, {
      email: 'nina@example.com',
      password: PW,
    });
    expect(login.status).toBe(401); // chờ kích hoạt ⇒ như sai thông tin
    const weak = await send('POST', '/auth/activate', undefined, {
      token,
      password: 'nina-mat-khau-dai',
    });
    expect(weak.status).toBe(400);
    const done = await send('POST', '/auth/activate', undefined, { token, password: PW });
    expect(done.status).toBe(200);
    expect(done.body.data.accessToken).toBeTruthy();
    expect(done.headers.get('Set-Cookie')).toContain('tf_rt=');
    const again = await send('POST', '/auth/activate', undefined, { token, password: PW });
    expect([again.status, again.body.error?.code]).toEqual([410, 'ACTIVATION_GONE']);
    const junk = await send('POST', '/auth/activation/inspect', undefined, {
      token: 'x'.repeat(43),
    });
    expect([junk.status, junk.body.error?.code]).toEqual([400, 'ACTIVATION_INVALID']);
  });

  it('tạo lại link ⇒ link cũ 410 ngay; danh sách theo trạng thái (pending) + tìm theo tên; HR không tạo được người có email đang làm', async () => {
    const { send, adminToken, hire } = setup();
    const first = await hire('nina@example.com', 'Nina');
    const userId = (first.body.data.employee as { userId: string }).userId;
    const old = activation(first)?.token ?? '';
    const again = await send('POST', `/hr/employees/${userId}/activation-link`, adminToken);
    expect(again.status).toBe(200);
    expect((await send('POST', '/auth/activation/inspect', undefined, { token: old })).status).toBe(
      410,
    );
    const pending = await send('GET', '/hr/employees?status=pending&q=nin', adminToken);
    expect(
      (pending.body.data as unknown as Array<{ fullName: string }>).map((e) => e.fullName),
    ).toEqual(['Nina']);
    const dup = await hire('nina@example.com', 'Nina 2');
    expect([dup.status, dup.body.error?.details.reason]).toEqual([409, 'already_employee']);
    expect(
      (await hire('tuong-lai@example.com', 'Tương Lai', '2026-10-16')).body.error?.details.rule,
    ).toBe('START_DATE_OUT_OF_RANGE');
  });

  it('nghỉ việc: cảnh báo OWNER duy nhất; ngày cuối đã qua ⇒ LEFT, đăng nhập 401; nhận lại ⇒ không cần link (đã có mật khẩu)', async () => {
    const { api, send, adminToken, hire } = setup();
    const { user: mia, defaultWorkspaceId } = api.db.createUser({
      email: 'mia@example.com',
      password: PW,
      fullName: 'Mia',
    });
    const sched = await send('PUT', `/hr/employees/${mia.id}/offboarding`, adminToken, {
      lastDay: '2026-10-31',
    });
    expect(sched.body.data.warnings).toEqual({
      pendingLeaveCount: 0,
      soleOwnerWorkspaces: [{ id: defaultWorkspaceId, name: 'Workspace của Mia' }],
    });
    expect((sched.body.data.employee as { status: string }).status).toBe('OFFBOARDING');
    const cancelled = await send('DELETE', `/hr/employees/${mia.id}/offboarding`, adminToken);
    expect((cancelled.body.data as { status: string }).status).toBe('ACTIVE');
    api.db.company.add(mia.id, '2026-10-01T00:00:00+07:00', '2026-10-01'); // vào làm 01/10 (ngày cuối không trước ngày vào)
    await send('PUT', `/hr/employees/${mia.id}/offboarding`, adminToken, { lastDay: '2026-10-14' });
    const left = await send('GET', '/hr/employees?status=left', adminToken);
    expect((left.body.data as unknown as Array<{ userId: string }>).map((e) => e.userId)).toEqual([
      mia.id,
    ]);
    expect(
      (await send('POST', '/auth/login', undefined, { email: 'mia@example.com', password: PW }))
        .status,
    ).toBe(401);
    const back = await hire('mia@example.com', 'Mia');
    expect([back.status, back.body.data.accountCreated, back.body.data.activation]).toEqual([
      201,
      false,
      null,
    ]);
    expect(
      (await send('POST', '/auth/login', undefined, { email: 'mia@example.com', password: PW }))
        .status,
    ).toBe(200);
  });

  it('HR cho chính mình / người giữ grant nghỉ ⇒ 403; nhân viên thường gọi route HR ⇒ 403', async () => {
    const { api, send } = setup();
    const { user: pam } = api.db.createUser({
      email: 'pam@example.com',
      password: PW,
      fullName: 'Pam',
    });
    api.db.company.setAccess(pam.id, 'EMPLOYEE', ['HR_MANAGE']);
    const { user: max } = api.db.createUser({
      email: 'max@example.com',
      password: PW,
      fullName: 'Max',
    });
    api.db.company.setAccess(max.id, 'EMPLOYEE', ['PAYROLL_MANAGE']);
    const pamToken = api.db.issueAccess(pam).accessToken;
    const body = { lastDay: '2026-10-31' };
    expect((await send('PUT', `/hr/employees/${pam.id}/offboarding`, pamToken, body)).status).toBe(
      403,
    );
    expect((await send('PUT', `/hr/employees/${max.id}/offboarding`, pamToken, body)).status).toBe(
      403,
    );
    const maxToken = api.db.issueAccess(max).accessToken;
    expect((await send('GET', '/hr/employees', maxToken)).status).toBe(403);
  });
});

describe('mock nghỉ việc theo T-062 (B)', () => {
  it('HR nhắm Admin ⇒ 403; Admin cuối cùng ⇒ 409 last_admin; trước ngày vào làm ⇒ 422; hoàn tất đúng 06:00 hôm sau', async () => {
    let now = Date.parse('2026-10-15T03:00:00.000Z'); // 10:00 VN
    const api = createMockApi(BASE, { now: () => now });
    const call = async (token: string, path: string, body: unknown, method = 'PUT') => {
      const response = await getResponse(
        api.handlers,
        new Request(BASE + path, {
          method,
          headers: {
            'content-type': 'application/json',
            origin: ORIGIN,
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        }),
      );
      return { status: response?.status, body: (await response?.json()) as Json };
    };
    const mk = (email: string, name: string) =>
      api.db.createUser({ email, password: PW, fullName: name }).user;
    const admin = mk('olivia@example.com', 'Olivia');
    api.db.company.setAccess(admin.id, 'ADMIN');
    const pam = mk('pam@example.com', 'Pam');
    api.db.company.setAccess(pam.id, 'EMPLOYEE', ['HR_MANAGE']);
    const mia = mk('mia@example.com', 'Mia');
    const adminToken = api.db.issueAccess(admin).accessToken;
    const pamToken = api.db.issueAccess(pam).accessToken;
    const off = (userId: string) => `/hr/employees/${userId}/offboarding`;
    expect((await call(pamToken, off(admin.id), { lastDay: '2026-10-31' })).status).toBe(403);
    const last = await call(adminToken, off(admin.id), { lastDay: '2026-10-31' });
    expect([last.status, last.body.error?.details.reason]).toEqual([409, 'last_admin']);
    const early = await call(adminToken, off(mia.id), { lastDay: '2026-10-14' });
    expect(early.body.error?.details.rule).toBe('LAST_DAY_OUT_OF_RANGE'); // Mia vào làm 15/10
    await call(adminToken, off(mia.id), { lastDay: '2026-10-15' });
    now = Date.parse('2026-10-16T05:59:00+07:00');
    expect(api.db.company.of(mia.id)?.status).toBe('OFFBOARDING');
    const fresh = () => api.db.issueAccess(admin).accessToken; // đồng hồ nhảy qua đêm ⇒ token cũ hết hạn
    const list = await call(fresh(), '/hr/employees?status=left', undefined, 'GET');
    expect(list.body.data).toEqual([]);
    now = Date.parse('2026-10-16T06:00:00+07:00');
    const after = await call(fresh(), '/hr/employees?status=left', undefined, 'GET');
    expect((after.body.data as unknown as Array<{ userId: string }>).map((e) => e.userId)).toEqual([
      mia.id,
    ]);
  });
});

describe('mock quản trị', () => {
  it('phân quyền: version cũ 409; ADMIN + grant 422; hạ Admin cuối cùng 409 last_admin; HR không đổi quyền ⇒ 403', async () => {
    const { api, send, admin, adminToken } = setup();
    const { user: pam } = api.db.createUser({
      email: 'pam@example.com',
      password: PW,
      fullName: 'Pam',
    });
    const list = await send('GET', '/admin/access', adminToken);
    const row = (list.body.data as unknown as Array<{ userId: string; version: number }>).find(
      (r) => r.userId === pam.id,
    );
    const set = await send('PUT', `/admin/access/${pam.id}`, adminToken, {
      role: 'EMPLOYEE',
      grants: ['HR_MANAGE'],
      expectedVersion: row?.version,
    });
    expect(set.body.data).toMatchObject({
      grants: ['HR_MANAGE'],
      version: (row?.version ?? 0) + 1,
    });
    const stale = await send('PUT', `/admin/access/${pam.id}`, adminToken, {
      role: 'EMPLOYEE',
      grants: [],
      expectedVersion: row?.version,
    });
    expect(stale.body.error?.code).toBe('VERSION_CONFLICT');
    const bad = await send('PUT', `/admin/access/${pam.id}`, adminToken, {
      role: 'ADMIN',
      grants: ['HR_MANAGE'],
      expectedVersion: (row?.version ?? 0) + 1,
    });
    expect(bad.body.error?.details.rule).toBe('GRANT_NOT_ALLOWED');
    const last = await send('PUT', `/admin/access/${admin.id}`, adminToken, {
      role: 'EMPLOYEE',
      grants: [],
      expectedVersion: api.db.company.row(admin.id)?.version,
    });
    expect(last.body.error?.details.reason).toBe('last_admin');
    const pamToken = api.db.issueAccess(pam).accessToken;
    expect((await send('GET', '/admin/access', pamToken)).status).toBe(403);
  });

  it('workspace mồ côi lên đầu; giao OWNER chỉ cho thành viên còn lại; còn OWNER ⇒ 409; tên công ty theo version', async () => {
    const { api, send, adminToken } = setup();
    const { user: otto, defaultWorkspaceId: ws } = api.db.createUser({
      email: 'otto@example.com',
      password: PW,
      fullName: 'Otto',
    });
    const { user: vic } = api.db.createUser({
      email: 'vic@example.com',
      password: PW,
      fullName: 'Vic',
    });
    const membership = api.db.membershipIn(otto.id, ws);
    if (!membership) throw new Error('thiếu membership');
    api.db.setMembership(vic.id, membership, 'MEMBER');
    expect(
      (await send('POST', `/admin/workspaces/${ws}/owner`, adminToken, { userId: vic.id })).body
        .error?.details.reason,
    ).toBe('workspace_has_owner');
    api.db.workspaces.removeMember(ws, otto.id); // OWNER duy nhất nghỉ việc
    const list = await send('GET', '/admin/workspaces', adminToken);
    expect((list.body.data as unknown as Array<{ id: string; orphan: boolean }>)[0]).toMatchObject({
      id: ws,
      orphan: true,
    });
    const outsider = await send('POST', `/admin/workspaces/${ws}/owner`, adminToken, {
      userId: otto.id,
    });
    expect(outsider.body.error?.details.rule).toBe('NOT_WORKSPACE_MEMBER');
    const given = await send('POST', `/admin/workspaces/${ws}/owner`, adminToken, {
      userId: vic.id,
    });
    expect(given.body.data).toMatchObject({
      orphan: false,
      owners: [{ id: vic.id, fullName: 'Vic' }],
    });
    const renamed = await send('PATCH', '/company', adminToken, {
      name: 'Công ty ABC',
      expectedVersion: 1,
    });
    expect(renamed.body.data).toEqual({ name: 'Công ty ABC', version: 2, privacyContact: null });
    expect(
      (await send('PATCH', '/company', adminToken, { name: 'X', expectedVersion: 1 })).status,
    ).toBe(409);
  });
});
