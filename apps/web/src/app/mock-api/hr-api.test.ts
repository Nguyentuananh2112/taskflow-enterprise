import type { CompanyGrant } from '@taskflow/contracts/company';
import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';

// Mock phía HR (T-041c) phải khó tính như API thật (A/D chốt; attendance-leave.md §5, §9): quyền
// `hr:manage` trước validate, luật "không tự xử lý của mình", máy trạng thái đơn, CSV chống injection.
// Mốc 3.5: cấp CÔNG TY — route gốc, Lan là Admin (ngầm có hr:manage, KHÔNG chấm công), HR = grant HR_MANAGE.

const BASE = 'http://localhost:4000/api/v1';
const ORIGIN = 'http://localhost:4000';

type Json = { data: unknown; error?: { code: string; details: Record<string, unknown> } };

async function setup() {
  // Thứ 5, 2026-10-15 03:00Z = 10:00 giờ Việt Nam.
  const now = Date.parse('2026-10-15T03:00:00.000Z');
  const api = createMockApi(BASE, { now: () => now });
  const raw = async (method: string, path: string, token: string, body?: unknown) => {
    const response = await getResponse(
      api.handlers,
      new Request(BASE + path, {
        method,
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          authorization: `Bearer ${token}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    return response;
  };
  const send = async (method: string, path: string, token: string, body?: unknown) => {
    const response = await raw(method, path, token, body);
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Json };
  };
  // ADR-137: không còn /auth/register — tạo tài khoản thẳng trong mock.
  const register = (email: string, fullName: string) => {
    const { user, defaultWorkspaceId } = api.db.createUser({
      email,
      password: 'cay-tre-xanh-ven-song',
      fullName,
    });
    return Promise.resolve({
      token: api.db.issueAccess(user).accessToken,
      id: user.id,
      ws: defaultWorkspaceId,
    });
  };
  const owner = await register('lan@example.com', 'Trần Lan');
  api.db.company.setAccess(owner.id, 'ADMIN');
  const join = async (email: string, fullName: string, grants: CompanyGrant[] = []) => {
    const u = await register(email, fullName);
    if (grants.length > 0) api.db.company.setAccess(u.id, 'EMPLOYEE', grants);
    return u;
  };
  const grant = (userId: string, grants: CompanyGrant[]) =>
    api.db.company.setAccess(userId, 'EMPLOYEE', grants);
  return { api, send, raw, owner, join, grant };
}

describe('mock HR — quyền', () => {
  it('nhân viên thường ⇒ 403 kể cả khi query/body sai (B-M4); được cấp HR_MANAGE ⇒ 200 ngay', async () => {
    const { send, join, grant } = await setup();
    const an = await join('an@example.com', 'Nguyễn An');
    expect((await send('GET', '/attendance?month=bad', an.token)).status).toBe(403);
    expect((await send('POST', '/attendance/events', an.token, { x: 1 })).status).toBe(403);
    expect((await send('GET', '/leave/requests?status=PENDING', an.token)).status).toBe(403);
    grant(an.id, ['HR_MANAGE']);
    expect((await send('GET', '/attendance/today', an.token)).status).toBe(200);
    // Lịch/ngày lễ: đọc được với mọi người thuộc công ty.
    const viewer = await join('vy@example.com', 'Khách Vy');
    expect((await send('GET', '/attendance/schedules', viewer.token)).status).toBe(200);
    expect((await send('GET', '/attendance/holidays?year=2026', viewer.token)).status).toBe(200);
  });
});

describe('mock HR — chấm công', () => {
  it('hôm nay: nhân viên công ty (Admin không chấm công) sắp theo tên; bảng tháng đủ ngày + tổng; lượt thô', async () => {
    const { send, owner, join } = await setup();
    await join('an@example.com', 'Nguyễn An');
    await join('vy@example.com', 'Khách Vy');
    const today = await send('GET', '/attendance/today', owner.token);
    const members = (today.body.data as { members: Array<{ user: { fullName: string } }> }).members;
    expect(members.map((m) => m.user.fullName)).toEqual(['Khách Vy', 'Nguyễn An']);
    const month = await send('GET', '/attendance?month=2026-10', owner.token);
    const rows = month.body.data as Array<{
      days: Array<{ date: string; status: string }>;
      totals: { absentDays: number };
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.days).toHaveLength(31);
    // Gia nhập hôm nay (15/10) ⇒ ngày trước đó NOT_EMPLOYED, không tính vắng (A: NOT_EMPLOYED tính 0).
    expect(rows[0]?.days[13]).toMatchObject({ date: '2026-10-14', status: 'NOT_EMPLOYED' });
    expect(rows[0]?.totals.absentDays).toBe(0);
    const stranger = crypto.randomUUID();
    const none = await send(
      'GET',
      `/attendance/events?userId=${stranger}&date=2026-10-15`,
      owner.token,
    );
    expect(none.status).toBe(404);
  });

  it('ADJUSTMENT ⇒ 201 {event, day}; hủy ⇒ 200, hủy lại ⇒ 409 already_voided; HR tự sửa của mình ⇒ 403, Admin sửa cho HR được', async () => {
    const { send, owner, join } = await setup();
    const an = await join('an@example.com', 'Nguyễn An');
    const hr = await join('ha@example.com', 'Lê Hà', ['HR_MANAGE']);
    const body = {
      userId: an.id,
      kind: 'IN',
      date: '2026-10-14',
      time: '08:10',
      reason: 'Quên chấm',
    };
    const added = await send('POST', '/attendance/events', hr.token, body);
    expect(added.status).toBe(201);
    const change = added.body.data as {
      event: { id: string; source: string; note: string };
      day: { firstIn: string; lateMin: number };
    };
    expect(change.event.source).toBe('ADJUSTMENT');
    expect(change.event.note).toBe('Quên chấm');
    expect(change.day.firstIn).toBe('2026-10-14T01:10:00.000Z');
    expect(change.day.lateMin).toBe(10);
    const voidPath = `/attendance/events/${change.event.id}/void`;
    expect((await send('POST', voidPath, hr.token, { reason: 'Nhầm' })).status).toBe(200);
    const again = await send('POST', voidPath, hr.token, { reason: 'Nhầm' });
    expect([again.status, again.body.error?.details.reason]).toEqual([409, 'already_voided']);
    const own = await send('POST', '/attendance/events', hr.token, {
      ...body,
      userId: hr.id,
    });
    expect(own.status).toBe(403);
    const byAdmin = await send('POST', '/attendance/events', owner.token, {
      ...body,
      userId: hr.id,
    });
    expect(byAdmin.status).toBe(201);
  });

  it('CSV: BOM, tên file, no-store, ô chữ bắt đầu bằng = được vô hiệu hóa (OWASP)', async () => {
    const { raw, owner, join } = await setup();
    await join('evil@example.com', '=HYPERLINK("x")');
    const response = await raw('GET', '/attendance/export.csv?month=2026-10', owner.token);
    expect(response.headers.get('Content-Disposition')).toContain('cham-cong-2026-10.csv');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await response.text();
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text).not.toMatch(/(^|,)"=HYPERLINK/m);
  });
});

describe('mock HR — lịch & ngày lễ', () => {
  it('lịch quá khứ ⇒ 422 SCHEDULE_IN_PAST; trùng ngày ⇒ thay; lễ quá khứ: HR 422, Admin cần lý do', async () => {
    const { send, owner, join } = await setup();
    const hr = await join('ha@example.com', 'Lê Hà', ['HR_MANAGE']);
    const sched = {
      effectiveFrom: '2026-10-20',
      timezone: 'Asia/Ho_Chi_Minh',
      workdays: 0b0011111,
      startMin: 480,
      endMin: 1020,
      breakStartMin: 720,
      breakEndMin: 780,
      graceMin: 5,
    };
    const path = '/attendance/schedules';
    const past = await send('POST', path, hr.token, { ...sched, effectiveFrom: '2026-10-01' });
    expect([past.status, past.body.error?.details.rule]).toEqual([422, 'SCHEDULE_IN_PAST']);
    expect((await send('POST', path, hr.token, sched)).status).toBe(201);
    expect((await send('POST', path, hr.token, { ...sched, graceMin: 10 })).status).toBe(201);
    const list = (await send('GET', path, hr.token)).body.data as Array<{ graceMin: number }>;
    expect(list.map((s) => s.graceMin)).toEqual([10]);

    const old = '/attendance/holidays/2026-09-02';
    const byHr = await send('PUT', old, hr.token, { name: 'Quốc khánh', reason: 'bổ sung' });
    expect(byHr.body.error?.details.rule).toBe('HOLIDAY_IN_PAST');
    const noReason = await send('PUT', old, owner.token, { name: 'Quốc khánh' });
    expect(noReason.body.error?.details.rule).toBe('REASON_REQUIRED');
    expect(
      (await send('PUT', old, owner.token, { name: 'Quốc khánh', reason: 'bổ sung' })).status,
    ).toBe(200);
    expect((await send('DELETE', '/attendance/holidays/2026-12-31', hr.token, {})).status).toBe(
      204,
    );
  });
});

describe('mock HR — nghỉ phép', () => {
  async function withRequest() {
    const s = await setup();
    const an = await s.join('an@example.com', 'Nguyễn An');
    const created = await s.send('POST', '/leave/requests', an.token, {
      type: 'ANNUAL',
      startDate: '2026-10-19',
      endDate: '2026-10-20',
      dayPart: 'FULL',
    });
    const leave = created.body.data as { id: string; version: number };
    return { ...s, an, leave };
  }

  it('danh sách HR (?status) ≠ của tôi (?mine=1); duyệt ⇒ APPROVED + thông báo; version cũ ⇒ 409', async () => {
    const { api, send, owner, an, leave } = await withRequest();
    const hrList = await send('GET', '/leave/requests?status=PENDING', owner.token);
    expect((hrList.body.data as unknown[]).length).toBe(1);
    const mine = await send('GET', '/leave/requests?mine=1', an.token);
    expect((mine.body.data as unknown[]).length).toBe(1);
    const ok = await send('POST', `/leave/requests/${leave.id}/approve`, owner.token, {
      expectedVersion: leave.version,
    });
    expect((ok.body.data as { status: string }).status).toBe('APPROVED');
    expect(api.notifications.of(an.id, api.db).map((n) => n.type)).toContain('LEAVE_APPROVED');
    const stale = await send('POST', `/leave/requests/${leave.id}/reject`, owner.token, {
      expectedVersion: leave.version,
    });
    expect(stale.body.error?.code).toBe('VERSION_CONFLICT');
  });

  it('thu hồi bắt buộc lý do (400); đơn PENDING thu hồi ⇒ 409 invalid_transition; HR tự duyệt đơn mình ⇒ 403', async () => {
    const { send, owner, join, leave } = await withRequest();
    const revoke = `/leave/requests/${leave.id}/revoke`;
    expect((await send('POST', revoke, owner.token, { expectedVersion: 1 })).status).toBe(400);
    const pending = await send('POST', revoke, owner.token, { expectedVersion: 1, note: 'x' });
    expect(pending.body.error?.details.reason).toBe('invalid_transition');
    const hr = await join('ha@example.com', 'Lê Hà', ['HR_MANAGE']);
    const own = await send('POST', '/leave/requests', hr.token, {
      type: 'UNPAID',
      startDate: '2026-10-22',
      endDate: '2026-10-22',
      dayPart: 'AM',
    });
    const id = (own.body.data as { id: string }).id;
    const self = await send('POST', `/leave/requests/${id}/approve`, hr.token, {
      expectedVersion: 1,
    });
    expect(self.status).toBe(403);
  });

  it('số dư: danh sách gồm nhân viên hiện tại; PATCH tuyệt đối ⇒ dòng mới; năm ngoài ±1 ⇒ 400; HR tự chỉnh ⇒ 403', async () => {
    const { send, owner, join, an } = await withRequest();
    const list = await send('GET', '/leave/balances?year=2026', owner.token);
    const rows = list.body.data as Array<{ userId: string; pendingDays: number }>;
    expect(rows.find((r) => r.userId === an.id)?.pendingDays).toBe(2);
    const patched = await send('PATCH', `/leave/balances/${an.id}/2026`, owner.token, {
      adjustmentDays: 1.5,
    });
    expect(patched.body.data).toMatchObject({ adjustmentDays: 1.5, remainingDays: 13.5 });
    const far = await send('PATCH', `/leave/balances/${an.id}/2030`, owner.token, {
      adjustmentDays: 1,
    });
    expect(far.status).toBe(400);
    const hr = await join('ha@example.com', 'Lê Hà', ['HR_MANAGE']);
    const self = await send('PATCH', `/leave/balances/${hr.id}/2026`, hr.token, {
      adjustmentDays: 1,
    });
    expect(self.status).toBe(403);
  });
});

describe('mock HR — thông báo theo quyền hiện tại (B-H3)', () => {
  it('HR (grant công ty) thấy LEAVE_SUBMITTED; bị thu HR_MANAGE ⇒ thông báo đó biến mất khỏi chuông', async () => {
    const { api, send, join, grant } = await setup();
    const ha = await join('ha@example.com', 'Lê Hà', ['HR_MANAGE']);
    api.notifications.notify(ha.id, {
      type: 'LEAVE_SUBMITTED',
      refId: crypto.randomUUID(),
      actor: null,
      leave: { type: 'ANNUAL', startDate: '2026-10-19', endDate: '2026-10-19' },
    });
    const count = async () =>
      (
        (await send('GET', '/me/notifications/unread-count', ha.token)).body.data as {
          count: number;
        }
      ).count;
    expect(await count()).toBe(1);
    grant(ha.id, []);
    expect(await count()).toBe(0);
  });
});
