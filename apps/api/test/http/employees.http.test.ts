// T-062: vòng đời nhân viên qua route thật (ADR-137) — danh sách, lịch nghỉ / hủy / hoàn tất (trong request + job),
// tạo lại link, nhận lại. Lưu trữ InMemory; giờ test 2026-11-01T00:00Z = 07:00 01/11 giờ VN.
import { EmployeeDto, OffboardingResponse } from '@taskflow/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, PASSWORD, WEB, type TestApp, type TestUser } from '../support/http-app';

const HR = '/api/v1/hr/employees';

let t: TestApp;
let admin: TestUser;
let hana: TestUser; // EMPLOYEE + HR_MANAGE

beforeEach(async () => {
  t = createTestApp();
  admin = await t.register('Olivia', undefined, { role: 'ADMIN', workspace: false });
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'], workspace: false });
});

const as = (by: TestUser) => ({
  get: (path = '') => request(t.app).get(`${HR}${path}`).set(by.auth),
  post: (path: string, body?: object) =>
    request(t.app)
      .post(`${HR}${path}`)
      .set(by.auth)
      .set('Content-Type', 'application/json')
      .send(body ?? {}),
  put: (path: string, body: object) => request(t.app).put(`${HR}${path}`).set(by.auth).send(body),
  del: (path: string) => request(t.app).delete(`${HR}${path}`).set(by.auth),
});
const list = async (by: TestUser, query = '') =>
  envelopeOf<EmployeeDto[]>(await as(by).get(query)).data ?? [];
const offboard = (by: TestUser, userId: string, lastDay: string) =>
  as(by).put(`/${userId}/offboarding`, { lastDay });
const login = (email: string) =>
  request(t.app)
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', t.nextIp())
    .send({ email, password: PASSWORD });

describe('GET /hr/employees', () => {
  it('nhân viên (không Admin), trạng thái suy ra, sắp theo tên; tìm theo tên / email; nhân viên thường ⇒ 403', async () => {
    const mia = await t.register('Mia');
    const hired = await as(hana).post('', { email: 'pat@example.com', fullName: 'Pat' });
    expect(hired.status).toBe(201);
    const rows = await list(hana);
    expect(rows.map((e) => [e.fullName, e.status])).toEqual([
      ['Hana', 'ACTIVE'],
      ['Mia', 'ACTIVE'],
      ['Pat', 'PENDING_ACTIVATION'],
    ]);
    for (const e of rows) expect(EmployeeDto.strict().parse(e)).toEqual(e);
    expect((await list(hana, '?status=pending')).map((e) => e.fullName)).toEqual(['Pat']);
    expect((await list(admin, '?q=MIA@EXAMPLE')).map((e) => e.userId)).toEqual([mia.id]);
    const page = envelopeOf<EmployeeDto[]>(await as(admin).get('?limit=2'));
    expect(page.data).toHaveLength(2);
    const next = await as(admin).get(`?limit=2&cursor=${page.meta?.page?.nextCursor ?? ''}`);
    expect(envelopeOf<EmployeeDto[]>(next).data?.map((e) => e.fullName)).toEqual(['Pat']);
    expect((await as(mia).get()).status).toBe(403);
  });
});

describe('PUT / DELETE /hr/employees/:userId/offboarding', () => {
  it('lịch tương lai ⇒ OFFBOARDING + cảnh báo ws OWNER duy nhất; hủy ⇒ ACTIVE; hủy lần 2 ⇒ 404', async () => {
    const mia = await t.register('Mia');
    const res = await offboard(hana, mia.id, '2026-11-08');
    expect(res.status).toBe(200);
    const body = OffboardingResponse.parse(envelopeOf(res).data);
    expect(body.employee).toMatchObject({ status: 'OFFBOARDING', offboardLastDay: '2026-11-08' });
    expect(body.warnings).toEqual({
      pendingLeaveCount: 0,
      soleOwnerWorkspaces: [{ id: mia.workspaceId, name: expect.any(String) as string }],
    });
    const me = await request(t.app).get('/api/v1/auth/me').set(mia.auth);
    expect(envelopeOf<{ company: unknown }>(me).data?.company).toMatchObject({
      status: 'OFFBOARDING',
      offboardLastDay: '2026-11-08',
    });
    const cancelled = await as(hana).del(`/${mia.id}/offboarding`);
    expect(EmployeeDto.parse(envelopeOf(cancelled).data)).toMatchObject({ status: 'ACTIVE' });
    expect(errorOf(await as(hana).del(`/${mia.id}/offboarding`))).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('lastDay ngoài [hôm nay − 31, + 90] hoặc trước ngày bắt đầu ⇒ 422 LAST_DAY_OUT_OF_RANGE; người lạ ⇒ 404', async () => {
    const mia = await t.register('Mia');
    for (const lastDay of ['2026-09-30', '2027-01-31', '2026-10-31']) {
      expect(errorOf(await offboard(hana, mia.id, lastDay)).details).toMatchObject({
        rule: 'LAST_DAY_OUT_OF_RANGE',
      });
    }
    const ghost = '00000000-0000-7000-8000-0000000fffff';
    expect((await offboard(hana, ghost, '2026-11-08')).status).toBe(404);
  });

  it('SEC-HR-31: HR không cho nghỉ chính mình / Admin / người giữ grant (403) — Admin làm được', async () => {
    const kim = await t.register('Kim', undefined, { grants: ['PAYROLL_MANAGE'] });
    expect((await offboard(hana, hana.id, '2026-11-08')).status).toBe(403);
    expect((await offboard(hana, admin.id, '2026-11-08')).status).toBe(403);
    expect((await offboard(hana, kim.id, '2026-11-08')).status).toBe(403);
    expect((await offboard(admin, kim.id, '2026-11-08')).status).toBe(200);
    expect((await offboard(admin, admin.id, '2026-11-08')).status).toBe(403); // tự cho mình nghỉ
  });

  it('Admin cuối cùng ⇒ 409 last_admin; có Admin khác ⇒ được', async () => {
    const other = await t.register('Otto', undefined, { role: 'ADMIN', workspace: false });
    expect((await offboard(admin, other.id, '2026-11-08')).status).toBe(200);
    expect(errorOf(await offboard(other, admin.id, '2026-11-08'))).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      details: { reason: 'last_admin' },
    });
  });

  it('ngày làm cuối đã qua ⇒ hoàn tất NGAY: LEFT, rời ws (mồ côi), login 401, refresh 401, socket bị chặn', async () => {
    const mia = await t.register('Mia', undefined, { startDate: '2026-10-01' });
    const res = await offboard(hana, mia.id, '2026-10-30');
    expect(EmployeeDto.parse(envelopeOf<OffboardingResponse>(res).data?.employee)).toMatchObject({
      status: 'LEFT',
      offboardLastDay: '2026-10-30',
      version: null,
    });
    expect(await list(hana)).not.toContainEqual(expect.objectContaining({ userId: mia.id }));
    expect((await list(hana, '?status=left')).map((e) => e.userId)).toEqual([mia.id]);
    expect((await login(mia.email)).status).toBe(401);
    const refresh = await request(t.app)
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB)
      .set('Content-Type', 'application/json')
      .set('Cookie', mia.cookie);
    expect(refresh.status).toBe(401);
    expect(await t.companyStore.find(mia.id)).toBeNull();
    expect(t.companyStore.departures()).toEqual([
      expect.objectContaining({ userId: mia.id, lastDay: '2026-10-30', reason: 'OFFBOARDED' }),
    ]);
    const members = await request(t.app)
      .get(`/api/v1/workspaces/${mia.workspaceId}/members`)
      .set(admin.auth);
    expect(members.status).toBe(404); // Admin không phải thành viên — ws còn lại 0 người (mồ côi)
  });

  it('job mỗi phút: lastDay hôm nay ⇒ còn quyền tới 06:00 ngày sau; qua mốc ⇒ job hoàn tất đúng một lần', async () => {
    const mia = await t.register('Mia');
    expect((await offboard(hana, mia.id, '2026-11-01')).status).toBe(200);
    expect(await t.container.company.completeDueOffboardings()).toEqual({
      completed: 0,
      failed: 0,
    });
    t.clock.advance(23 * 3600_000); // 06:00 02/11 giờ VN
    expect(await t.container.company.completeDueOffboardings()).toEqual({
      completed: 1,
      failed: 0,
    });
    expect(await t.container.company.completeDueOffboardings()).toEqual({
      completed: 0,
      failed: 0,
    });
    expect(t.companyStore.departures()).toHaveLength(1);
    expect((await login(mia.email)).status).toBe(401);
  });
});

describe('nhận lại + tạo lại link (ADR-137)', () => {
  it('người đã nghỉ có mật khẩu ⇒ nhận lại: accountCreated false, không link, login bằng mật khẩu cũ', async () => {
    const mia = await t.register('Mia', undefined, { startDate: '2026-10-01' });
    expect((await offboard(hana, mia.id, '2026-10-30')).status).toBe(200);
    const back = await as(hana).post('', { email: mia.email, fullName: 'Mia' });
    expect(back.status).toBe(201);
    expect(envelopeOf(back).data).toMatchObject({
      employee: { userId: mia.id, status: 'ACTIVE', startDate: '2026-11-01' },
      accountCreated: false,
      activation: null,
    });
    expect((await login(mia.email)).status).toBe(200);
    // Phiên cũ KHÔNG sống lại (đã thu hồi lúc nghỉ — SEC-HR-68).
    expect((await request(t.app).get('/api/v1/auth/me').set(mia.auth)).status).toBe(401);
  });

  it('tạo lại link: link cũ chết ngay (410), link mới dùng được; đã kích hoạt ⇒ 422 ALREADY_ACTIVATED', async () => {
    const hired = await as(hana).post('', { email: 'pat@example.com', fullName: 'Pat' });
    const { employee, activation } = envelopeOf<{
      employee: { userId: string };
      activation: { token: string };
    }>(hired).data!;
    const again = await as(hana).post(`/${employee.userId}/activation-link`);
    expect(again.status).toBe(200);
    expect(again.headers['cache-control']).toBe('no-store');
    const fresh = envelopeOf<{ activation: { token: string } }>(again).data!.activation.token;
    const activate = (token: string) =>
      request(t.app)
        .post('/api/v1/auth/activate')
        .set('Origin', WEB)
        .set('X-Forwarded-For', t.nextIp())
        .send({ token, password: PASSWORD });
    expect((await activate(activation.token)).status).toBe(410);
    expect((await activate(fresh)).status).toBe(200);
    expect(
      errorOf(await as(hana).post(`/${employee.userId}/activation-link`)).details,
    ).toMatchObject({ rule: 'ALREADY_ACTIVATED' });
  });

  it('SEC-HR-63b: tạo lại link cho MỘT người lần 11 trong giờ ⇒ 429; người khác vẫn được (hạn mức theo người đích)', async () => {
    const pending = async (email: string) =>
      envelopeOf<{ employee: { userId: string } }>(
        await as(admin).post('', { email, fullName: email.split('@')[0] }),
      ).data!.employee.userId;
    const pat = await pending('pat@example.com');
    const quinn = await pending('quinn@example.com');
    for (let i = 1; i <= 10; i += 1) {
      expect((await as(admin).post(`/${pat}/activation-link`)).status, `lần ${i}`).toBe(200);
    }
    const eleventh = await as(hana).post(`/${pat}/activation-link`); // actor khác vẫn chung bộ đếm của người đích
    expect([eleventh.status, errorOf(eleventh).code]).toEqual([429, 'RATE_LIMITED']);
    expect((await as(admin).post(`/${quinn}/activation-link`)).status).toBe(200);
  });
});

describe('ADR-135 thứ tự lỗi trên /hr (A SEC-HR-35): 401 SESSION_REVOKED → 403 → 400', () => {
  it('nhân viên không hr:manage gửi body / query sai ⇒ 403 (không lộ luật validate); người đã rời ⇒ 401 SESSION_REVOKED', async () => {
    const mia = await t.register('Mia', undefined, { workspace: false });
    const ghost = '00000000-0000-7000-8000-0000000fffff';
    const calls = (by: TestUser) =>
      Promise.all(
        (
          [
            ['POST /employees', as(by).post('', { nonsense: true })],
            ['GET /employees', as(by).get('?status=bogus&limit=999')],
            [
              'PUT offboarding',
              as(by).put(`/${ghost}/offboarding`, { lastDay: 'không phải ngày' }),
            ],
            ['POST activation-link', as(by).post(`/not-a-uuid/activation-link`)],
            ['DELETE offboarding', as(by).del(`/not-a-uuid/offboarding`)],
          ] as const
        ).map(async ([label, call]) => [label, await call] as const),
      );
    for (const [label, res] of await calls(mia)) {
      expect([res.status, errorOf(res).code], label).toEqual([403, 'FORBIDDEN_ACCESS']);
    }
    t.companyStore.removeMember(mia.id);
    for (const [label, res] of await calls(mia)) {
      expect([res.status, errorOf(res).code], label).toEqual([401, 'SESSION_REVOKED']);
    }
    // Có quyền ⇒ tới validate như thường.
    expect((await as(hana).post('', { nonsense: true })).status).toBe(400);
  });
});
