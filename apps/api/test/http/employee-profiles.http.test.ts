// T-054 (hr-extended ADR-128): hồ sơ nhân viên qua route thật — EP-01…08, EP-11 + luật self / quyền trước validate.
// Lưu trữ InMemory; giờ test 2026-11-01T00:00Z = 07:00 01/11 giờ VN ⇒ "hôm nay" = 2026-11-01.
import { EmployeeDto, EmployeeProfileDto, PutEmployeeProfileResponse } from '@taskflow/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

const PROFILES = '/api/v1/hr/employee-profiles';
const EMPLOYEES = '/api/v1/hr/employees';
const GHOST = '00000000-0000-7000-8000-0000000fffff';

let t: TestApp;
let admin: TestUser;
let hana: TestUser; // EMPLOYEE + HR_MANAGE
let mia: TestUser; // EMPLOYEE

beforeEach(async () => {
  t = createTestApp();
  admin = await t.register('Olivia', undefined, { role: 'ADMIN', workspace: false });
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'], workspace: false });
  mia = await t.register('Mia', undefined, { workspace: false, startDate: '2026-10-01' });
});

const get = (by: TestUser, path: string) => request(t.app).get(`${PROFILES}${path}`).set(by.auth);
const put = (by: TestUser, userId: string, body: object) =>
  request(t.app).put(`${PROFILES}/${userId}`).set(by.auth).send(body);
const hire = (by: TestUser, body: object) => request(t.app).post(EMPLOYEES).set(by.auth).send(body);
const profileOf = (res: request.Response) =>
  PutEmployeeProfileResponse.parse(envelopeOf(res).data).profile;
const auditOf = async (action: string) =>
  (
    envelopeOf<{ action: string; targetUserId: string; before: unknown; after: unknown }[]>(
      await request(t.app).get('/api/v1/hr/audit-logs').set(admin.auth),
    ).data ?? []
  ).filter((a) => a.action === action);

describe('GET hr/employee-profiles/:userId · /me · /departments', () => {
  it('chưa có hồ sơ ⇒ 200 trường null, version 0, missingHireDate; người chưa từng là nhân viên / Admin ⇒ 404', async () => {
    const res = await get(hana, `/${mia.id}`);
    expect(res.status).toBe(200);
    expect(EmployeeProfileDto.strict().parse(envelopeOf(res).data)).toEqual({
      userId: mia.id,
      fullName: 'Mia',
      status: 'ACTIVE',
      hireDate: null,
      department: null,
      jobTitle: null,
      workPhone: null,
      version: 0,
      seniority: null,
      missingHireDate: true,
    });
    expect(errorOf(await get(hana, `/${admin.id}`)).details).toMatchObject({ resource: 'user' });
    expect((await get(hana, `/${GHOST}`)).status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('EP-08: /me và /departments không bị /:userId bắt; /me của Admin ⇒ 403; nhân viên thường đọc hồ sơ người khác ⇒ 403', async () => {
    await put(hana, mia.id, { department: 'Kho', jobTitle: 'Thủ kho', expectedVersion: 0 });
    const me = await get(mia, '/me');
    expect(me.status).toBe(200);
    expect(EmployeeProfileDto.parse(envelopeOf(me).data)).toMatchObject({
      userId: mia.id,
      department: 'Kho',
      version: 1,
    });
    expect((await get(admin, '/me')).status).toBe(403);
    const suggestions = await get(hana, '/departments');
    expect(envelopeOf(suggestions).data).toEqual({ departments: ['Kho'], jobTitles: ['Thủ kho'] });
    expect((await get(mia, '/departments')).status).toBe(403);
    expect((await get(mia, `/${hana.id}`)).status).toBe(403);
  });
});

describe('PUT hr/employee-profiles/:userId', () => {
  it('EP-01: tạo với expectedVersion 0 ⇒ version 1; lặp 0 ⇒ 409 VERSION_CONFLICT kèm bản hiện tại', async () => {
    const created = await put(hana, mia.id, {
      hireDate: '2021-11-17',
      department: '  Kế toán ',
      expectedVersion: 0,
    });
    expect(created.status).toBe(200);
    expect(profileOf(created)).toMatchObject({
      hireDate: '2021-11-17',
      department: 'Kế toán',
      version: 1,
      seniority: { years: 4, months: 11 },
      missingHireDate: false,
    });
    expect(PutEmployeeProfileResponse.parse(envelopeOf(created).data)).toMatchObject({
      negativeBalances: [],
      warnings: [],
    });
    const again = errorOf(await put(hana, mia.id, { jobTitle: 'X', expectedVersion: 0 }));
    expect(again).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 1 } });
  });

  it('EP-02: biên hireDate — 1949-12-31 ⇒ 400, 1950-01-01 và hôm nay ⇒ 200, ngày mai ⇒ 422 HIRE_DATE_IN_FUTURE', async () => {
    expect((await put(hana, mia.id, { hireDate: '1949-12-31', expectedVersion: 0 })).status).toBe(
      400,
    );
    expect(
      errorOf(await put(hana, mia.id, { hireDate: '2026-11-02', expectedVersion: 0 })).details,
    ).toMatchObject({ rule: 'HIRE_DATE_IN_FUTURE' });
    expect((await put(hana, mia.id, { hireDate: '1950-01-01', expectedVersion: 0 })).status).toBe(
      200,
    );
    const today = await put(hana, mia.id, {
      hireDate: '2026-11-01',
      expectedVersion: 1,
      reason: 'Nhập nhầm năm',
    });
    expect(profileOf(today).seniority).toEqual({ years: 0, months: 0 });
  });

  it('EP-03: SĐT chuẩn hóa còn + và chữ số; 7 / 16 chữ số ⇒ 400; trường lạ ⇒ 400 (strict)', async () => {
    const ok = await put(hana, mia.id, { workPhone: '+84 (90) 123-45.67', expectedVersion: 0 });
    expect(profileOf(ok).workPhone).toBe('+84901234567');
    for (const workPhone of ['1234567', '1234567890123456', '+84 abc 1234']) {
      expect((await put(hana, mia.id, { workPhone, expectedVersion: 1 })).status).toBe(400);
    }
    for (const extra of [{ userId: mia.id }, { version: 3 }, { updatedById: hana.id }]) {
      expect((await put(hana, mia.id, { ...extra, expectedVersion: 1 })).status).toBe(400);
    }
  });

  it('EP-04 + EP-06: đổi hireDate đã có thiếu lý do ⇒ 422 REASON_REQUIRED; có lý do ⇒ audit PROFILE_SET (note, không workPhone) + thông báo', async () => {
    await put(hana, mia.id, {
      hireDate: '2020-01-01',
      workPhone: '0901234567',
      expectedVersion: 0,
    });
    expect(
      errorOf(await put(hana, mia.id, { hireDate: '2019-06-01', expectedVersion: 1 })).details,
    ).toMatchObject({ rule: 'REASON_REQUIRED' });
    // Đặt lần đầu (từ null) không cần lý do — đã kiểm ở bước trên (tạo).
    const changed = await put(hana, mia.id, {
      hireDate: '2019-06-01',
      workPhone: '0907654321',
      expectedVersion: 1,
      reason: 'Hợp đồng gốc ký 01/06/2019',
    });
    expect(profileOf(changed)).toMatchObject({ hireDate: '2019-06-01', version: 2 });

    const audits = await auditOf('PROFILE_SET');
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      targetUserId: mia.id,
      before: { hireDate: '2020-01-01', department: null, jobTitle: null },
      after: {
        hireDate: '2019-06-01',
        workPhoneChanged: true,
        note: 'Hợp đồng gốc ký 01/06/2019',
      },
    });
    for (const a of audits) {
      expect(JSON.stringify(a)).not.toMatch(/090\d{7}|workPhone"|"reason"/);
    }
    const inbox = envelopeOf<{ type: string; refId: string }[]>(
      await request(t.app).get('/api/v1/me/notifications').set(mia.auth),
    ).data;
    expect(inbox?.filter((n) => n.type === 'PROFILE_UPDATED')).toHaveLength(2);
    expect(inbox?.find((n) => n.type === 'PROFILE_UPDATED')).toMatchObject({ refId: mia.id });
  });

  it('không đổi gì ⇒ 200, không ghi (version giữ, không audit)', async () => {
    await put(hana, mia.id, { department: 'Kho', expectedVersion: 0 });
    const same = await put(hana, mia.id, { department: 'Kho', expectedVersion: 1 });
    expect(profileOf(same).version).toBe(1);
    expect(await auditOf('PROFILE_SET')).toHaveLength(1);
  });

  it('luật self tuyệt đối: HR sửa hồ sơ của mình ⇒ 403 (HR khác / Admin sửa được); không có hr:manage ⇒ 403 TRƯỚC validate', async () => {
    expect((await put(hana, hana.id, { department: 'HR', expectedVersion: 0 })).status).toBe(403);
    expect((await put(admin, hana.id, { department: 'HR', expectedVersion: 0 })).status).toBe(200);
    expect((await put(mia, hana.id, { nonsense: true })).status).toBe(403);
    expect((await put(mia, 'not-a-uuid', {})).status).toBe(403);
  });

  it('EP-05: người đã nghỉ vẫn sửa được (không gửi thông báo); Admin chưa từng là nhân viên ⇒ 404', async () => {
    await request(t.app)
      .put(`${EMPLOYEES}/${mia.id}/offboarding`)
      .set(hana.auth)
      .send({ lastDay: '2026-10-31' });
    const res = await put(hana, mia.id, { jobTitle: 'Cựu thủ kho', expectedVersion: 0 });
    expect(res.status).toBe(200);
    expect(profileOf(res)).toMatchObject({ status: 'LEFT', jobTitle: 'Cựu thủ kho' });
    expect(errorOf(await put(hana, admin.id, { expectedVersion: 0 })).details).toMatchObject({
      resource: 'user',
    });
  });
});

describe('GET hr/employees — cột hồ sơ (T-054)', () => {
  it('hireDate / department / jobTitle / seniority / missingHireDate; KHÔNG có workPhone', async () => {
    await put(hana, mia.id, {
      hireDate: '2021-11-17',
      department: 'Kho',
      jobTitle: 'Thủ kho',
      workPhone: '0901234567',
      expectedVersion: 0,
    });
    const rows = envelopeOf<EmployeeDto[]>(await request(t.app).get(EMPLOYEES).set(hana.auth)).data;
    for (const e of rows ?? []) expect(EmployeeDto.strict().parse(e)).toEqual(e);
    expect(rows?.find((e) => e.userId === mia.id)).toMatchObject({
      hireDate: '2021-11-17',
      department: 'Kho',
      jobTitle: 'Thủ kho',
      seniority: { years: 4, months: 11 },
      missingHireDate: false,
    });
    expect(rows?.find((e) => e.userId === hana.id)).toMatchObject({
      hireDate: null,
      seniority: null,
      missingHireDate: true,
    });
  });
});

describe('EP-11: POST hr/employees mở rộng', () => {
  it('có trường hồ sơ ⇒ hồ sơ + nhân viên cùng transaction; audit PROFILE_SET không có rehire', async () => {
    const res = await hire(hana, {
      email: 'pat@example.com',
      fullName: 'Pat',
      hireDate: '2026-10-20',
      department: 'Kho',
      workPhone: '0901 234 567',
    });
    expect(res.status).toBe(201);
    const userId = envelopeOf<{ employee: { userId: string } }>(res).data?.employee.userId ?? '';
    expect(EmployeeProfileDto.parse(envelopeOf(await get(hana, `/${userId}`)).data)).toMatchObject({
      status: 'PENDING_ACTIVATION',
      hireDate: '2026-10-20',
      department: 'Kho',
      workPhone: '0901234567',
      version: 1,
    });
    const [audit] = await auditOf('PROFILE_SET');
    expect(audit?.after).not.toHaveProperty('rehire');
  });

  it('không có trường hồ sơ ⇒ như Mốc 3.5 (không tạo hồ sơ); hireDate tương lai ⇒ 422 và không còn gì (rollback)', async () => {
    const plain = await hire(hana, { email: 'pat@example.com', fullName: 'Pat' });
    const patId = envelopeOf<{ employee: { userId: string } }>(plain).data?.employee.userId ?? '';
    expect(EmployeeProfileDto.parse(envelopeOf(await get(hana, `/${patId}`)).data).version).toBe(0);
    expect(await auditOf('PROFILE_SET')).toHaveLength(0);

    const future = await hire(hana, {
      email: 'quinn@example.com',
      fullName: 'Quinn',
      hireDate: '2026-11-02',
    });
    expect(errorOf(future).details).toMatchObject({ rule: 'HIRE_DATE_IN_FUTURE' });
    const rows = envelopeOf<EmployeeDto[]>(await request(t.app).get(EMPLOYEES).set(hana.auth)).data;
    expect(rows?.map((e) => e.fullName)).not.toContain('Quinn');
  });

  it('nhận lại: không gửi ⇒ giữ hồ sơ cũ; keepHireDate true ⇒ giữ hireDate cũ; false + hireDate mới ⇒ thay; audit rehire', async () => {
    await put(hana, mia.id, { hireDate: '2021-11-17', department: 'Kho', expectedVersion: 0 });
    const offboard = () =>
      request(t.app)
        .put(`${EMPLOYEES}/${mia.id}/offboarding`)
        .set(hana.auth)
        .send({ lastDay: '2026-10-05' });
    const rehire = (extra: object, startDate: string) =>
      hire(hana, { email: mia.email, fullName: 'Mia', startDate, ...extra });
    const profile = async () =>
      EmployeeProfileDto.parse(envelopeOf(await get(hana, `/${mia.id}`)).data);

    expect((await offboard()).status).toBe(200);
    expect((await rehire({}, '2026-10-10')).status).toBe(201);
    expect(await profile()).toMatchObject({
      hireDate: '2021-11-17',
      department: 'Kho',
      version: 1,
    });

    await request(t.app)
      .put(`${EMPLOYEES}/${mia.id}/offboarding`)
      .set(hana.auth)
      .send({ lastDay: '2026-10-15' });
    expect(
      (
        await rehire(
          { keepHireDate: true, hireDate: '2026-10-20', jobTitle: 'Tổ trưởng' },
          '2026-10-20',
        )
      ).status,
    ).toBe(201);
    expect(await profile()).toMatchObject({
      hireDate: '2021-11-17',
      jobTitle: 'Tổ trưởng',
      version: 2,
    });

    await request(t.app)
      .put(`${EMPLOYEES}/${mia.id}/offboarding`)
      .set(hana.auth)
      .send({ lastDay: '2026-10-25' });
    expect(
      (await rehire({ keepHireDate: false, hireDate: '2026-10-28' }, '2026-10-28')).status,
    ).toBe(201);
    expect(await profile()).toMatchObject({ hireDate: '2026-10-28', version: 3 });

    const audits = await auditOf('PROFILE_SET');
    expect(audits.slice(0, 2).map((a) => a.after)).toEqual([
      expect.objectContaining({ hireDate: '2026-10-28', rehire: true }),
      expect.objectContaining({ hireDate: '2021-11-17', jobTitle: 'Tổ trưởng', rehire: true }),
    ]);
  });
});
