// T-061a: /api/v1/admin/access qua HTTP thật (in-process) — quyền, thứ tự lỗi, thu hồi phiên, thông báo ACCESS_CHANGED.
import { AccessDto } from '@taskflow/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let olivia: TestUser; // Admin
let ada: TestUser; // Admin thứ hai
let hana: TestUser; // nhân viên + HR_MANAGE
let mia: TestUser; // nhân viên

const access = (path = '') => `/api/v1/admin/access${path}`;
const put = (by: TestUser, userId: string, body: object) =>
  request(t.app)
    .put(access(`/${userId}`))
    .set(by.auth)
    .send(body);

beforeEach(async () => {
  t = createTestApp();
  olivia = await t.register('Olivia', undefined, { role: 'ADMIN', workspace: false });
  ada = await t.register('Ada', undefined, { role: 'ADMIN', workspace: false });
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'], workspace: false });
  mia = await t.register('Mia', undefined, { workspace: false });
});

describe('GET /admin/access', () => {
  it('Admin ⇒ 200 danh sách (email, role, grants, trạng thái), no-store, khớp contract; HR ⇒ 403; chưa đăng nhập ⇒ 401', async () => {
    const res = await request(t.app).get(access()).set(olivia.auth);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const rows = envelopeOf<AccessDto[]>(res).data!;
    expect(rows.every((r) => AccessDto.safeParse(r).success)).toBe(true);
    expect(rows.map((r) => [r.fullName, r.role, r.grants])).toEqual([
      ['Ada', 'ADMIN', []],
      ['Hana', 'EMPLOYEE', ['HR_MANAGE']],
      ['Mia', 'EMPLOYEE', []],
      ['Olivia', 'ADMIN', []],
    ]);
    expect(rows.find((r) => r.fullName === 'Mia')?.email).toBe('mia@example.com');
    const hr = await request(t.app).get(access()).set(hana.auth);
    expect(hr.status).toBe(403);
    expect(errorOf(hr).details).toEqual({ required: 'company:admin' });
    expect((await request(t.app).get(access())).status).toBe(401);
  });
});

describe('PUT /admin/access/:userId', () => {
  it('cấp PAYROLL_MANAGE cho Hana ⇒ 200 version 2; Hana có thông báo ACCESS_CHANGED; phiên của Hana vẫn sống (chỉ đổi grant)', async () => {
    const res = await put(olivia, hana.id, {
      role: 'EMPLOYEE',
      grants: ['HR_MANAGE', 'PAYROLL_MANAGE'],
      expectedVersion: 1,
    });
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toMatchObject({
      grants: ['HR_MANAGE', 'PAYROLL_MANAGE'],
      version: 2,
    });
    const notes = await request(t.app).get('/api/v1/me/notifications').set(hana.auth);
    expect(notes.status).toBe(200);
    expect(
      envelopeOf<{ type: string; refId: string }[]>(notes).data?.map((n) => [n.type, n.refId]),
    ).toEqual([['ACCESS_CHANGED', hana.id]]);
  });

  it('nâng Mia lên Admin ⇒ 200, phiên cũ của Mia bị thu hồi (401), Mia không còn route nhân viên', async () => {
    const res = await put(olivia, mia.id, { role: 'ADMIN', grants: [], expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toMatchObject({ role: 'ADMIN', grants: [] });
    expect((await request(t.app).get('/api/v1/attendance/me/today').set(mia.auth)).status).toBe(
      401,
    );
  });

  it('thứ tự lỗi: HR (không company:grant) gửi body sai ⇒ 403 (không 400); Admin body sai / thừa trường ⇒ 400; tự đổi mình ⇒ 403; lệch version ⇒ 409; không thuộc công ty ⇒ 404 user', async () => {
    const hr = await put(hana, mia.id, { nonsense: true });
    expect(hr.status).toBe(403);
    expect(errorOf(hr).details).toEqual({ required: 'company:grant' });
    for (const body of [
      { role: 'BOSS', grants: [], expectedVersion: 1 },
      { role: 'EMPLOYEE', grants: [], expectedVersion: 1, startDate: '2026-01-01' },
    ]) {
      expect((await put(olivia, mia.id, body)).status).toBe(400);
    }
    expect(
      (await put(olivia, olivia.id, { role: 'EMPLOYEE', grants: [], expectedVersion: 1 })).status,
    ).toBe(403);
    const stale = await put(olivia, hana.id, { role: 'EMPLOYEE', grants: [], expectedVersion: 9 });
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
    const ghost = await put(olivia, '0199e5a2-0000-7000-8000-00000000dead', {
      role: 'EMPLOYEE',
      grants: [],
      expectedVersion: 1,
    });
    expect(ghost.status).toBe(404);
  });

  it('Admin + grants ⇒ 422 GRANT_NOT_ALLOWED; hạ Ada ⇒ 200 EMPLOYEE (vẫn còn Olivia là Admin)', async () => {
    const grant = await put(olivia, ada.id, {
      role: 'ADMIN',
      grants: ['HR_MANAGE'],
      expectedVersion: 1,
    });
    expect(grant.status).toBe(422);
    expect(errorOf(grant).details).toMatchObject({ rule: 'GRANT_NOT_ALLOWED' });
    const demote = await put(olivia, ada.id, { role: 'EMPLOYEE', grants: [], expectedVersion: 1 });
    expect(demote.status).toBe(200);
    expect(envelopeOf(demote).data).toMatchObject({ role: 'EMPLOYEE' });
  });
});

describe('nâng EMPLOYEE→ADMIN dọn đơn nghỉ (offboardCleanup thật của leave — D T-064)', () => {
  const leave = (path: string) => `/api/v1/leave${path}`;
  const submit = async (by: TestUser, body: object) => {
    const res = await request(t.app).post(leave('/requests')).set(by.auth).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return envelopeOf<{ id: string }>(res).data!.id;
  };
  const approve = async (id: string) => {
    const res = await request(t.app)
      .post(leave(`/requests/${id}/approve`))
      .set(hana.auth)
      .send({ expectedVersion: 1 });
    expect(res.status).toBe(200);
  };

  it('PENDING ⇒ CANCELLED, APPROVED bắt đầu sau ngày nâng ⇒ REVOKED, vắt qua ⇒ giữ; decidedBy = Admin, ghi chú hệ thống; HR nhận một OFFBOARD_CLEANUP; Mia (Admin) ⇒ 403 leave:self', async () => {
    // Giờ nghiệp vụ của harness = 01/11/2026 (Chủ nhật) — ngày nâng, ngày cuối nhiệm kỳ nhân viên của Mia.
    const pending = await submit(mia, {
      type: 'ANNUAL',
      startDate: '2026-11-23',
      endDate: '2026-11-24',
    });
    const after = await submit(mia, {
      type: 'ANNUAL',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
    });
    const straddle = await submit(mia, {
      type: 'ANNUAL',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
    });
    await approve(after);
    await approve(straddle);

    expect(
      (await put(olivia, mia.id, { role: 'ADMIN', grants: [], expectedVersion: 1 })).status,
    ).toBe(200);

    const list = await request(t.app).get(leave('/requests')).set(hana.auth);
    const byId = new Map(
      envelopeOf<
        {
          id: string;
          status: string;
          decisionNote: string | null;
          decidedBy: { id: string } | null;
        }[]
      >(list).data!.map((r) => [r.id, r]),
    );
    expect(byId.get(pending)).toMatchObject({
      status: 'CANCELLED',
      decisionNote: 'Nghỉ việc — hệ thống',
      decidedBy: { id: olivia.id },
    });
    expect(byId.get(after)).toMatchObject({ status: 'REVOKED', decidedBy: { id: olivia.id } });
    expect(byId.get(straddle)).toMatchObject({ status: 'APPROVED', decidedBy: { id: hana.id } });

    const notes = await request(t.app).get('/api/v1/me/notifications').set(hana.auth);
    expect(
      envelopeOf<{ type: string; refId: string }[]>(notes)
        .data!.filter((n) => n.type === 'OFFBOARD_CLEANUP')
        .map((n) => n.refId),
    ).toEqual([mia.id]);

    const again = await t.login(mia.email);
    const self = await request(t.app)
      .get(leave('/balances/me?year=2026'))
      .set({ Authorization: `Bearer ${again.token}`, 'X-Forwarded-For': again.ip });
    expect(self.status).toBe(403);
    expect(errorOf(self).details).toEqual({ required: 'leave:self' });
  });
});

describe('/admin/workspaces', () => {
  const ws = (path = '') => `/api/v1/admin/workspaces${path}`;

  it('ws mồ côi (OWNER duy nhất rời): Admin thấy cờ + thành viên còn lại, giao OWNER cho thành viên ⇒ 200 + audit; người ngoài ws ⇒ 422; HR ⇒ 403', async () => {
    const otto = await t.register('Otto');
    const pam = await t.register('Pam');
    const add = await request(t.app)
      .post(`/api/v1/workspaces/${otto.workspaceId}/members`)
      .set(otto.auth)
      .send({ userId: pam.id, role: 'PM' });
    expect(add.status).toBe(201);
    // OWNER duy nhất rời ws (như hoàn tất nghỉ việc — T-062): gỡ dòng membership.
    await t.persistence.workspace.memberships.remove(otto.workspaceId, otto.id);

    const list = await request(t.app).get(ws()).set(olivia.auth);
    expect(list.status).toBe(200);
    const row = envelopeOf<
      {
        id: string;
        orphan: boolean;
        owners: unknown[];
        memberCount: number;
        members: { userId: string }[];
      }[]
    >(list).data!.find((w) => w.id === otto.workspaceId);
    expect(row).toMatchObject({
      orphan: true,
      owners: [],
      memberCount: 1,
      members: [{ userId: pam.id }],
    });
    expect((await request(t.app).get(ws()).set(hana.auth)).status).toBe(403);

    const outsider = await request(t.app)
      .post(ws(`/${otto.workspaceId}/owner`))
      .set(olivia.auth)
      .send({ userId: mia.id });
    expect(outsider.status).toBe(422);
    expect(errorOf(outsider).details).toMatchObject({ rule: 'NOT_WORKSPACE_MEMBER' });

    const ok = await request(t.app)
      .post(ws(`/${otto.workspaceId}/owner`))
      .set(olivia.auth)
      .send({ userId: pam.id });
    expect(ok.status).toBe(200);
    expect(envelopeOf(ok).data).toMatchObject({
      orphan: false,
      owners: [{ id: pam.id }],
      members: [],
    });
    const audit = (await t.persistence.company.hrAudit.list({ limit: 100 })).items;
    expect(audit.map((a) => [a.action, a.targetUserId, a.refId])).toContainEqual([
      'WORKSPACE_OWNER_ASSIGNED',
      pam.id,
      otto.workspaceId,
    ]);

    const again = await request(t.app)
      .post(ws(`/${otto.workspaceId}/owner`))
      .set(olivia.auth)
      .send({ userId: pam.id });
    expect(again.status).toBe(409);
    expect(errorOf(again).details).toMatchObject({ reason: 'workspace_has_owner' });
  });

  it('lưu trữ: còn thành viên ⇒ 409; 0 thành viên ⇒ 200 archivedAt; body lạ ⇒ 400', async () => {
    const otto = await t.register('Otto');
    const archive = () =>
      request(t.app)
        .post(ws(`/${otto.workspaceId}/archive`))
        .set(olivia.auth);
    expect((await archive().send({})).status).toBe(409);
    await t.persistence.workspace.memberships.remove(otto.workspaceId, otto.id);
    expect((await archive().send({ force: true })).status).toBe(400);
    const done = await archive().send({});
    expect(done.status).toBe(200);
    expect(envelopeOf<{ archivedAt: string | null }>(done).data?.archivedAt).not.toBeNull();
  });
});
