// T-039 → T-064 (cấp công ty): route nghỉ phép `/api/v1/leave` qua app thật (InMemory) — thứ tự lỗi 401 → 403 →
// 400, permit TRƯỚC validate (SEC-HR-02), route `me` không nhận userId (SEC-HR-03), người ngoài công ty 401
// SESSION_REVOKED, Admin không phải nhân viên (ADR-134), không tự xử lý (SEC-HR-07), reason chỉ người gửi + HR
// (SEC-HR-15), audit qua HrAuditLog cấp công ty.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let olivia: TestUser; // Admin — duyệt được, không xin nghỉ
let hana: TestUser; // nhân viên + HR_MANAGE
let mia: TestUser;
let max: TestUser;
let otto: TestUser; // đã đăng nhập rồi rời công ty

const leave = (path: string) => `/api/v1/leave${path}`;
const get = (by: TestUser, path: string) => request(t.app).get(leave(path)).set(by.auth);
const post = (by: TestUser, path: string, body: object = {}) =>
  request(t.app).post(leave(path)).set(by.auth).send(body);
const patch = (by: TestUser, path: string, body: object) =>
  request(t.app).patch(leave(path)).set(by.auth).send(body);
const twoDays = { type: 'ANNUAL', startDate: '2026-11-23', endDate: '2026-11-24' };

interface LeaveDto {
  id: string;
  version: number;
  status: string;
  days: number;
  reason?: string | null;
  decidedBy: { id: string; fullName: string } | null;
}

/** HrAuditLog cấp công ty qua `GET /hr/audit-logs` (chỉ Admin — Olivia). */
const auditRows = async () =>
  envelopeOf<{ action: string; after: Record<string, unknown> | null }[]>(
    await request(t.app).get('/api/v1/hr/audit-logs?limit=100').set(olivia.auth),
  ).data ?? [];

beforeEach(async () => {
  t = createTestApp(); // nhân viên có nhiệm kỳ từ 01/11/2026 (giờ nghiệp vụ của harness)
  olivia = await t.register('Olivia', undefined, { role: 'ADMIN' });
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'] });
  [mia, max, otto] = [await t.register('Mia'), await t.register('Max'), await t.register('Otto')];
  t.persistence.companyStore!.removeMember(otto.id);
  await t.consentLeaveReason(hana, mia, max); // T-075: ca dưới gửi đơn CÓ lý do
});

describe('leave HTTP — luồng chính', () => {
  it('Mia gửi (reason bỏ trống ⇒ null) → danh sách của tôi + số dư → Hana duyệt → audit LEAVE_DECIDE không chứa reason', async () => {
    const submitted = await post(mia, '/requests', twoDays);
    expect(submitted.status).toBe(201);
    const dto = envelopeOf<LeaveDto>(submitted).data;
    expect(dto).toMatchObject({ status: 'PENDING', days: 2, reason: null, version: 1 });
    expect(submitted.headers['cache-control']).toBe('no-store');

    const mine = await get(mia, '/requests?mine=1');
    expect(mine.status).toBe(200);
    expect(envelopeOf<LeaveDto[]>(mine).data?.map((r) => r.id)).toEqual([dto?.id]);
    expect(envelopeOf(mine).meta?.page).toMatchObject({ hasMore: false, limit: 50 });
    const balance = await get(mia, '/balances/me?year=2026');
    expect(envelopeOf(balance).data).toMatchObject({ pendingDays: 2, remainingDays: 10 });

    const approved = await post(hana, `/requests/${dto?.id}/approve`, { expectedVersion: 1 });
    expect(approved.status).toBe(200);
    expect(envelopeOf<LeaveDto>(approved).data).toMatchObject({
      status: 'APPROVED',
      version: 2,
      decidedBy: { id: hana.id, fullName: 'Hana' },
    });
    const actions = (await auditRows()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['LEAVE_SUBMIT', 'LEAVE_DECIDE']));
  });

  it('preview: { days, remainingDays } không ghi gì; Chủ nhật ⇒ 422 NO_WORKING_DAYS', async () => {
    const res = await get(
      mia,
      '/requests/preview?type=ANNUAL&startDate=2026-11-23&endDate=2026-11-24',
    );
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toEqual({ days: 2, remainingDays: 12 });
    const sunday = await get(
      mia,
      '/requests/preview?type=ANNUAL&startDate=2026-11-22&endDate=2026-11-22',
    );
    expect(sunday.status).toBe(422);
    expect(errorOf(sunday).details).toMatchObject({ rule: 'NO_WORKING_DAYS' });
    expect(envelopeOf<unknown[]>(await get(mia, '/requests?mine=1')).data).toEqual([]);
  });

  it('PATCH số dư (Hana) ⇒ 200 dòng số dư mới; danh sách số dư HR = nhân viên công ty theo tên (không Admin, không người đã rời)', async () => {
    const res = await patch(hana, `/balances/${mia.id}/2026`, { adjustmentDays: -2.5 });
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toMatchObject({
      userId: mia.id,
      user: { fullName: 'Mia' },
      adjustmentDays: -2.5,
      remainingDays: 9.5,
    });
    const list = await get(hana, '/balances?year=2026');
    expect(list.status).toBe(200);
    expect(
      envelopeOf<{ user: { fullName: string } }[]>(list).data?.map((r) => r.user.fullName),
    ).toEqual(['Hana', 'Max', 'Mia']);
  });

  it('Admin (Olivia) duyệt được đơn của nhân viên', async () => {
    const dto = envelopeOf<LeaveDto>(await post(mia, '/requests', twoDays)).data;
    const res = await post(olivia, `/requests/${dto?.id}/approve`, { expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(envelopeOf<LeaveDto>(res).data).toMatchObject({ decidedBy: { id: olivia.id } });
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
      await post(mia, '/requests', { ...twoDays, reason: 'sốt cao' }),
    ).data;
    for (const hr of [olivia, hana]) {
      const notes = (await inbox(hr)).filter((n) => n.type === 'LEAVE_SUBMITTED');
      expect(notes.map((n) => n.refId)).toEqual([dto?.id]);
      expect(notes[0]?.leave).toMatchObject({ type: 'ANNUAL', startDate: '2026-11-23' });
      expect(JSON.stringify(notes)).not.toContain('sốt cao');
    }
    expect((await inbox(max)).filter((n) => n.type.startsWith('LEAVE_'))).toEqual([]);
    await post(hana, `/requests/${dto?.id}/approve`, { expectedVersion: 1 });
    expect((await inbox(mia)).map((n) => n.type)).toContain('LEAVE_APPROVED');
  });

  it('Hana (HR) tự gửi đơn ⇒ chỉ HR KHÁC (Olivia) nhận — không tự báo cho chính mình', async () => {
    await post(hana, '/requests', twoDays);
    expect((await inbox(olivia)).map((n) => n.type)).toContain('LEAVE_SUBMITTED');
    expect((await inbox(hana)).filter((n) => n.type === 'LEAVE_SUBMITTED')).toEqual([]);
  });
});

describe('leave ↔ attendance (T-063 nối thật)', () => {
  interface Day {
    date: string;
    status: string;
    leave: string | null;
  }
  it('duyệt đơn FULL ⇒ attendance/me?month có ngày đó ON_LEAVE (FULL); bảng công HR tăng upcomingLeaveDays', async () => {
    const dto = envelopeOf<LeaveDto>(await post(mia, '/requests', twoDays)).data;
    await post(hana, `/requests/${dto?.id}/approve`, { expectedVersion: 1 });

    const mine = await request(t.app).get('/api/v1/attendance/me?month=2026-11').set(mia.auth);
    expect(mine.status).toBe(200);
    const days = envelopeOf<{ days: Day[] }>(mine).data?.days ?? [];
    for (const date of ['2026-11-23', '2026-11-24']) {
      expect(days.find((d) => d.date === date)).toMatchObject({
        status: 'ON_LEAVE',
        leave: 'FULL',
      });
    }
    expect(days.find((d) => d.date === '2026-11-25')?.leave).toBeNull();

    const hr = await request(t.app).get('/api/v1/attendance?month=2026-11').set(hana.auth);
    expect(hr.status).toBe(200);
    // T-046 (TL d9): tổng chỉ đếm tới hôm nay — đơn đã duyệt ở tương lai vào cột "Phép sắp tới".
    const rows =
      envelopeOf<
        { user: { id: string }; totals: { leaveDays: number; upcomingLeaveDays: number } }[]
      >(hr).data;
    expect(rows?.find((r) => r.user.id === mia.id)?.totals).toMatchObject({
      leaveDays: 0,
      upcomingLeaveDays: 2,
    });
    expect(rows?.find((r) => r.user.id === max.id)?.totals.upcomingLeaveDays).toBe(0);
  });

  it('lịch thật của attendance: ngày lễ HR đặt giữa khoảng đơn ⇒ preview / số ngày đơn không tính ngày đó', async () => {
    const put = await request(t.app)
      .put('/api/v1/attendance/holidays/2026-11-24')
      .set(hana.auth)
      .send({ name: 'Lễ thử' });
    expect([200, 201]).toContain(put.status);
    const res = await get(
      mia,
      '/requests/preview?type=ANNUAL&startDate=2026-11-23&endDate=2026-11-24',
    );
    expect(envelopeOf(res).data).toEqual({ days: 1, remainingDays: 12 });
  });
});

describe('leave HTTP — thứ tự lỗi & bảo mật', () => {
  it('chưa đăng nhập ⇒ 401; Otto (đã rời công ty, token còn hạn) ⇒ 401 SESSION_REVOKED ở mọi route', async () => {
    expect((await request(t.app).get(leave('/requests?mine=1'))).status).toBe(401);
    for (const res of [
      await get(otto, '/requests?mine=1'),
      await post(otto, '/requests', twoDays),
      await get(otto, '/balances/me?year=2026'),
    ]) {
      expect(res.status).toBe(401);
      expect(errorOf(res).code).toBe('SESSION_REVOKED');
    }
  });

  it('SEC-HR-02: Mia gọi route hr:manage ⇒ 403 — kể cả body/query SAI (permit trước validate)', async () => {
    for (const res of [
      await get(mia, '/requests'),
      await get(mia, '/requests?status=NOPE'),
      await get(mia, '/balances?year=abc'),
      await post(mia, `/requests/${olivia.id}/approve`, { expectedVersion: 'x' }),
      await post(mia, `/requests/${olivia.id}/revoke`, {}),
      await patch(mia, `/balances/${max.id}/2026`, { adjustmentDays: 'x' }),
    ]) {
      expect(res.status).toBe(403);
      expect(errorOf(res).details).toMatchObject({ required: 'hr:manage' });
    }
  });

  it('SEC-HR-03: route của tôi không nhận userId (strict ⇒ 400); ADR-134: Admin gửi đơn / xem số dư của mình ⇒ 403 leave:self', async () => {
    expect((await get(mia, `/requests?mine=1&userId=${max.id}`)).status).toBe(400);
    expect((await get(mia, `/balances/me?year=2026&userId=${max.id}`)).status).toBe(400);
    for (const res of [
      await post(olivia, '/requests', twoDays),
      await get(olivia, '/balances/me?year=2026'),
    ]) {
      expect(res.status).toBe(403);
      expect(errorOf(res).details).toMatchObject({ required: 'leave:self' });
    }
  });

  it('SEC-HR-05: Max hủy đơn của Mia ⇒ 404; SEC-HR-15: Hana (HR) thấy reason, Max không có route nào thấy', async () => {
    const dto = envelopeOf<LeaveDto>(
      await post(mia, '/requests', { ...twoDays, reason: 'khám bệnh' }),
    ).data;
    const cancel = await post(max, `/requests/${dto?.id}/cancel`, { expectedVersion: 1 });
    expect(cancel.status).toBe(404);
    const hr = envelopeOf<LeaveDto[]>(await get(hana, '/requests?status=PENDING')).data;
    expect(hr?.[0]?.reason).toBe('khám bệnh');
    expect(envelopeOf<LeaveDto[]>(await get(max, '/requests?mine=1')).data).toEqual([]);
    expect(JSON.stringify(await auditRows())).not.toContain('khám bệnh');
  });

  it('SEC-HR-07: Hana tự duyệt / tự PATCH số dư ⇒ 403; LV-20: revoke thiếu lý do ⇒ 400', async () => {
    const own = envelopeOf<LeaveDto>(await post(hana, '/requests', twoDays)).data;
    const self = await post(hana, `/requests/${own?.id}/approve`, { expectedVersion: 1 });
    expect(self.status).toBe(403);
    const selfPatch = await patch(hana, `/balances/${hana.id}/2026`, { adjustmentDays: 5 });
    expect(selfPatch.status).toBe(403);
    const miaReq = envelopeOf<LeaveDto>(await post(mia, '/requests', twoDays)).data;
    await post(hana, `/requests/${miaReq?.id}/approve`, { expectedVersion: 1 });
    const revoke = await post(hana, `/requests/${miaReq?.id}/revoke`, {
      expectedVersion: 2,
      note: '  ',
    });
    expect(revoke.status).toBe(400);
  });

  it('audit duyệt / thu hồi: KHÔNG chứa reason của đơn; note quản trị (trim) nằm ở after.note (B, B-H2)', async () => {
    const dto = envelopeOf<LeaveDto>(
      await post(mia, '/requests', { ...twoDays, reason: 'sốt cao' }),
    ).data;
    await post(hana, `/requests/${dto?.id}/approve`, { expectedVersion: 1 });
    await post(hana, `/requests/${dto?.id}/revoke`, {
      expectedVersion: 2,
      note: '  thiếu người  ',
    });
    const audit = await auditRows();
    expect(JSON.stringify(audit)).not.toContain('sốt cao');
    expect(audit.find((a) => a.action === 'LEAVE_REVOKE')?.after).toMatchObject({
      status: 'REVOKED',
      note: 'thiếu người',
    });
    expect(audit.find((a) => a.action === 'LEAVE_DECIDE')?.after).not.toHaveProperty('note');
  });

  it('SEC-HR-25: PATCH số dư cho người chưa từng là nhân viên năm đó (Admin, người ngoài) ⇒ 404; năm ngoài ±1 ⇒ 400', async () => {
    for (const userId of [olivia.id, '0199e5a2-0000-7000-8000-000000000999']) {
      const res = await patch(hana, `/balances/${userId}/2026`, { adjustmentDays: 1 });
      expect(res.status).toBe(404);
    }
    const far = await patch(hana, `/balances/${mia.id}/2024`, { adjustmentDays: 1 });
    expect(far.status).toBe(400);
  });
});
