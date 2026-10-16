// T-039: route nghỉ phép (thiết kế §5) qua app thật (InMemory) — thứ tự lỗi 404 → 403 → 400, permit TRƯỚC validate
// (SEC-HR-02), route `me` không nhận userId (SEC-HR-03), IDOR / tenant (SEC-HR-01/05/25), không tự xử lý (SEC-HR-07),
// reason chỉ người gửi + HR (SEC-HR-15), audit qua HrAuditLog của T-037.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let olivia: TestUser; // OWNER
let hana: TestUser; // MEMBER + HR_MANAGE
let mia: TestUser;
let max: TestUser;
let vic: TestUser; // VIEWER
let otto: TestUser; // OWNER workspace khác
let wsId: string;

const base = () => `/api/v1/workspaces/${wsId}`;
const get = (by: TestUser, path: string) => request(t.app).get(`${base()}${path}`).set(by.auth);
const post = (by: TestUser, path: string, body: object = {}) =>
  request(t.app).post(`${base()}${path}`).set(by.auth).send(body);
const patch = (by: TestUser, path: string, body: object) =>
  request(t.app).patch(`${base()}${path}`).set(by.auth).send(body);
const twoDays = { type: 'ANNUAL', startDate: '2026-11-23', endDate: '2026-11-24' };

interface LeaveDto {
  id: string;
  version: number;
  status: string;
  days: number;
  reason?: string | null;
  decidedBy: { id: string; fullName: string } | null;
}

beforeEach(async () => {
  t = createTestApp();
  olivia = await t.register('Olivia');
  wsId = olivia.workspaceId;
  [hana, mia, max, vic, otto] = [
    await t.register('Hana'),
    await t.register('Mia'),
    await t.register('Max'),
    await t.register('Vic'),
    await t.register('Otto'),
  ];
  for (const [u, role] of [
    [hana, 'MEMBER'],
    [mia, 'MEMBER'],
    [max, 'MEMBER'],
    [vic, 'VIEWER'],
  ] as const) {
    const res = await request(t.app)
      .post(`${base()}/members`)
      .set(olivia.auth)
      .send({ email: u.email, role });
    expect(res.status).toBe(201);
  }
  const grant = await request(t.app)
    .put(`${base()}/members/${hana.id}/grants`)
    .set(olivia.auth)
    .send({ grants: ['HR_MANAGE'] });
  expect(grant.status).toBe(200);
});

describe('leave HTTP — luồng chính', () => {
  it('Mia gửi (reason bỏ trống ⇒ null) → danh sách của tôi + số dư → Hana duyệt → audit LEAVE_DECIDE không chứa reason', async () => {
    const submitted = await post(mia, '/leave-requests', twoDays);
    expect(submitted.status).toBe(201);
    const dto = envelopeOf<LeaveDto>(submitted).data;
    expect(dto).toMatchObject({ status: 'PENDING', days: 2, reason: null, version: 1 });
    expect(submitted.headers['cache-control']).toBe('no-store');

    const mine = await get(mia, '/leave-requests?mine=1');
    expect(mine.status).toBe(200);
    expect(envelopeOf<LeaveDto[]>(mine).data?.map((r) => r.id)).toEqual([dto?.id]);
    expect(envelopeOf(mine).meta?.page).toMatchObject({ hasMore: false, limit: 50 });
    const balance = await get(mia, '/leave-balances/me?year=2026');
    expect(envelopeOf(balance).data).toMatchObject({ pendingDays: 2, remainingDays: 10 });

    const approved = await post(hana, `/leave-requests/${dto?.id}/approve`, {
      expectedVersion: 1,
    });
    expect(approved.status).toBe(200);
    expect(envelopeOf<LeaveDto>(approved).data).toMatchObject({
      status: 'APPROVED',
      version: 2,
      decidedBy: { id: hana.id, fullName: 'Hana' },
    });
    const audit = await get(olivia, '/hr-audit-logs');
    const actions = envelopeOf<{ action: string }[]>(audit).data?.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['LEAVE_SUBMIT', 'LEAVE_DECIDE']));
  });

  it('preview: { days, remainingDays } không ghi gì; Chủ nhật ⇒ 422 NO_WORKING_DAYS', async () => {
    const res = await get(
      mia,
      '/leave-requests/preview?type=ANNUAL&startDate=2026-11-23&endDate=2026-11-24',
    );
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toEqual({ days: 2, remainingDays: 12 });
    const sunday = await get(
      mia,
      '/leave-requests/preview?type=ANNUAL&startDate=2026-11-22&endDate=2026-11-22',
    );
    expect(sunday.status).toBe(422);
    expect(errorOf(sunday).details).toMatchObject({ rule: 'NO_WORKING_DAYS' });
    expect(envelopeOf<unknown[]>(await get(mia, '/leave-requests?mine=1')).data).toEqual([]);
  });

  it('PATCH số dư (Hana) ⇒ 200 dòng số dư mới; danh sách số dư HR sắp theo tên, không có VIEWER', async () => {
    const res = await patch(hana, `/leave-balances/${mia.id}/2026`, { adjustmentDays: -2.5 });
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toMatchObject({
      userId: mia.id,
      user: { fullName: 'Mia' },
      adjustmentDays: -2.5,
      remainingDays: 9.5,
    });
    const list = await get(hana, '/leave-balances?year=2026');
    expect(list.status).toBe(200);
    expect(
      envelopeOf<{ user: { fullName: string } }[]>(list).data?.map((r) => r.user.fullName),
    ).toEqual(['Hana', 'Max', 'Mia', 'Olivia']);
  });
});

describe('leave HTTP — thông báo bền (T-040, adapter thật)', () => {
  interface Note {
    type: string;
    refId: string;
    leave: { type: string; startDate: string } | null;
  }
  const inbox = async (u: TestUser) =>
    envelopeOf<Note[]>(await request(t.app).get('/api/v1/me/notifications').set(u.auth)).data ?? [];

  it('Mia gửi ⇒ HR (Olivia, Hana) nhận LEAVE_SUBMITTED kèm loại + ngày, không reason; Hana duyệt ⇒ Mia nhận LEAVE_APPROVED', async () => {
    const dto = envelopeOf<LeaveDto>(
      await post(mia, '/leave-requests', { ...twoDays, reason: 'sốt cao' }),
    ).data;
    for (const hr of [olivia, hana]) {
      const notes = (await inbox(hr)).filter((n) => n.type === 'LEAVE_SUBMITTED');
      expect(notes.map((n) => n.refId)).toEqual([dto?.id]);
      expect(notes[0]?.leave).toMatchObject({ type: 'ANNUAL', startDate: '2026-11-23' });
      expect(JSON.stringify(notes)).not.toContain('sốt cao');
    }
    expect((await inbox(max)).filter((n) => n.type.startsWith('LEAVE_'))).toEqual([]);
    await post(hana, `/leave-requests/${dto?.id}/approve`, { expectedVersion: 1 });
    expect((await inbox(mia)).map((n) => n.type)).toContain('LEAVE_APPROVED');
  });

  it('Hana (HR) tự gửi đơn ⇒ chỉ HR KHÁC (Olivia) nhận — không tự báo cho chính mình', async () => {
    await post(hana, '/leave-requests', twoDays);
    expect((await inbox(olivia)).map((n) => n.type)).toContain('LEAVE_SUBMITTED');
    expect((await inbox(hana)).filter((n) => n.type === 'LEAVE_SUBMITTED')).toEqual([]);
  });
});

describe('leave ↔ attendance (T-038 nối thật)', () => {
  interface Day {
    date: string;
    status: string;
    leave: string | null;
  }
  it('duyệt đơn FULL ⇒ attendance/me?month có ngày đó ON_LEAVE (FULL); bảng công HR tăng leaveDays', async () => {
    const dto = envelopeOf<LeaveDto>(await post(mia, '/leave-requests', twoDays)).data;
    await post(hana, `/leave-requests/${dto?.id}/approve`, { expectedVersion: 1 });

    const mine = await get(mia, '/attendance/me?month=2026-11');
    expect(mine.status).toBe(200);
    const days = envelopeOf<{ days: Day[] }>(mine).data?.days ?? [];
    for (const date of ['2026-11-23', '2026-11-24']) {
      expect(days.find((d) => d.date === date)).toMatchObject({
        status: 'ON_LEAVE',
        leave: 'FULL',
      });
    }
    expect(days.find((d) => d.date === '2026-11-25')?.leave).toBeNull();

    const hr = await get(hana, '/attendance?month=2026-11');
    expect(hr.status).toBe(200);
    const rows = envelopeOf<{ user: { id: string }; totals: { leaveDays: number } }[]>(hr).data;
    expect(rows?.find((r) => r.user.id === mia.id)?.totals.leaveDays).toBe(2);
    expect(rows?.find((r) => r.user.id === max.id)?.totals.leaveDays).toBe(0);
  });

  it('lịch thật của attendance: ngày lễ HR đặt giữa khoảng đơn ⇒ preview / số ngày đơn không tính ngày đó', async () => {
    const put = await request(t.app)
      .put(`${base()}/attendance/holidays/2026-11-24`)
      .set(olivia.auth)
      .send({ name: 'Lễ thử' });
    expect([200, 201]).toContain(put.status);
    const res = await get(
      mia,
      '/leave-requests/preview?type=ANNUAL&startDate=2026-11-23&endDate=2026-11-24',
    );
    expect(envelopeOf(res).data).toEqual({ days: 1, remainingDays: 12 });
  });
});

describe('leave HTTP — thứ tự lỗi & bảo mật', () => {
  it('SEC-HR-01: Otto (ws khác) gọi route leave của W1 ⇒ 404 workspace', async () => {
    for (const res of [
      await get(otto, '/leave-requests?mine=1'),
      await post(otto, '/leave-requests', twoDays),
      await get(otto, '/leave-balances/me?year=2026'),
    ]) {
      expect(res.status).toBe(404);
      expect(errorOf(res).details).toMatchObject({ resource: 'workspace' });
    }
  });

  it('SEC-HR-02: Mia gọi route hr:manage ⇒ 403 — kể cả body/query SAI (permit trước validate)', async () => {
    for (const res of [
      await get(mia, '/leave-requests'),
      await get(mia, '/leave-requests?status=NOPE'),
      await get(mia, '/leave-balances?year=abc'),
      await post(mia, `/leave-requests/${olivia.id}/approve`, { expectedVersion: 'x' }),
      await post(mia, `/leave-requests/${olivia.id}/revoke`, {}),
      await patch(mia, `/leave-balances/${max.id}/2026`, { adjustmentDays: 'x' }),
    ]) {
      expect(res.status).toBe(403);
      expect(errorOf(res).details).toMatchObject({ required: 'hr:manage' });
    }
  });

  it('SEC-HR-03: route của tôi không nhận userId (strict ⇒ 400); SEC-HR-06: Vic gửi đơn ⇒ 403', async () => {
    const res = await get(mia, `/leave-requests?mine=1&userId=${max.id}`);
    expect(res.status).toBe(400);
    const bal = await get(mia, `/leave-balances/me?year=2026&userId=${max.id}`);
    expect(bal.status).toBe(400);
    const vicRes = await post(vic, '/leave-requests', twoDays);
    expect(vicRes.status).toBe(403);
    expect(errorOf(vicRes).details).toMatchObject({ required: 'leave:self' });
  });

  it('SEC-HR-05: Max hủy đơn của Mia ⇒ 404; SEC-HR-15: Hana (HR) thấy reason, Max không có route nào thấy', async () => {
    const dto = envelopeOf<LeaveDto>(
      await post(mia, '/leave-requests', { ...twoDays, reason: 'khám bệnh' }),
    ).data;
    const cancel = await post(max, `/leave-requests/${dto?.id}/cancel`, { expectedVersion: 1 });
    expect(cancel.status).toBe(404);
    const hr = envelopeOf<LeaveDto[]>(await get(hana, '/leave-requests?status=PENDING')).data;
    expect(hr?.[0]?.reason).toBe('khám bệnh');
    expect(envelopeOf<LeaveDto[]>(await get(max, '/leave-requests?mine=1')).data).toEqual([]);
    const audit = await get(olivia, '/hr-audit-logs');
    expect(JSON.stringify(envelopeOf(audit).data)).not.toContain('khám bệnh');
  });

  it('SEC-HR-07: Hana tự duyệt / tự PATCH số dư ⇒ 403; LV-20: revoke thiếu lý do ⇒ 400', async () => {
    const own = envelopeOf<LeaveDto>(await post(hana, '/leave-requests', twoDays)).data;
    const self = await post(hana, `/leave-requests/${own?.id}/approve`, { expectedVersion: 1 });
    expect(self.status).toBe(403);
    const selfPatch = await patch(hana, `/leave-balances/${hana.id}/2026`, { adjustmentDays: 5 });
    expect(selfPatch.status).toBe(403);
    const miaReq = envelopeOf<LeaveDto>(await post(mia, '/leave-requests', twoDays)).data;
    await post(hana, `/leave-requests/${miaReq?.id}/approve`, { expectedVersion: 1 });
    const revoke = await post(hana, `/leave-requests/${miaReq?.id}/revoke`, {
      expectedVersion: 2,
      note: '  ',
    });
    expect(revoke.status).toBe(400);
  });

  it('audit duyệt / thu hồi: KHÔNG chứa reason của đơn; note quản trị (trim) nằm ở after.note (B, B-H2)', async () => {
    const dto = envelopeOf<LeaveDto>(
      await post(mia, '/leave-requests', { ...twoDays, reason: 'sốt cao' }),
    ).data;
    await post(hana, `/leave-requests/${dto?.id}/approve`, { expectedVersion: 1 });
    await post(hana, `/leave-requests/${dto?.id}/revoke`, {
      expectedVersion: 2,
      note: '  thiếu người  ',
    });
    const audit = envelopeOf<{ action: string; after: Record<string, unknown> | null }[]>(
      await get(olivia, '/hr-audit-logs'),
    ).data;
    expect(JSON.stringify(audit)).not.toContain('sốt cao');
    const revoke = audit?.find((a) => a.action === 'LEAVE_REVOKE');
    expect(revoke?.after).toMatchObject({ status: 'REVOKED', note: 'thiếu người' });
    expect(audit?.find((a) => a.action === 'LEAVE_DECIDE')?.after).not.toHaveProperty('note');
  });

  it('SEC-HR-25: PATCH số dư cho user của workspace khác ⇒ 404; năm ngoài ±1 ⇒ 400', async () => {
    const other = await patch(hana, `/leave-balances/${otto.id}/2026`, { adjustmentDays: 1 });
    expect(other.status).toBe(404);
    const far = await patch(hana, `/leave-balances/${mia.id}/2024`, { adjustmentDays: 1 });
    expect(far.status).toBe(400);
  });
});
