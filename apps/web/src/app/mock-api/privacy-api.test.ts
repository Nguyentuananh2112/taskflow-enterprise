import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';

// Mock thông báo quyền riêng tư (T-075, contracts G e01c5c85): như API thật — chưa xác nhận / chưa đồng ý mặc định, ack
// đúng phiên bản (khác ⇒ 409 privacy_version_outdated), đồng ý lý do nghỉ chặn `reason` của đơn nghỉ (400), Admin cũng
// gọi được, đầu mối liên hệ qua PATCH /company. Dữ liệu bịa.

const BASE = 'http://localhost:4000/api/v1';

type Json = {
  data: Record<string, unknown>;
  error?: { code: string; details: Record<string, unknown> | null };
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
  const [admin, mia] = [make('olivia'), make('mia')];
  api.db.company.setAccess(admin.id, 'ADMIN');
  const token = (u: typeof admin) => api.db.issueAccess(u).accessToken;
  return { api, send, mia, asAdmin: token(admin), asMia: token(mia) };
}

const leave = (reason?: string) => ({
  type: 'ANNUAL',
  startDate: '2026-10-19',
  endDate: '2026-10-19',
  dayPart: 'FULL',
  ...(reason === undefined ? {} : { reason }),
});

describe('mock quyền riêng tư (T-075)', () => {
  it('mặc định: cần xác nhận, chưa đồng ý, liên hệ null; Admin cũng gọi được', async () => {
    const { send, asMia, asAdmin } = setup();
    const me = await send('GET', '/me/privacy', asMia);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({
      version: 1,
      ackVersion: null,
      needsAck: true,
      consentLeaveReason: false,
      privacyContact: null,
    });
    expect((await send('GET', '/me/privacy', asAdmin)).status).toBe(200);
  });

  it('ack đúng phiên bản ⇒ hết needsAck; nội dung đổi (version mới) ⇒ cần đọc lại, ack bản cũ ⇒ 409', async () => {
    const { api, send, asMia } = setup();
    const ok = await send('POST', '/me/privacy/ack', asMia, { version: 1 });
    expect(ok.body.data).toMatchObject({ ackVersion: 1, needsAck: false });
    api.db.company.privacy.version = 2;
    expect((await send('GET', '/me/privacy', asMia)).body.data).toMatchObject({ needsAck: true });
    const stale = await send('POST', '/me/privacy/ack', asMia, { version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      details: { reason: 'privacy_version_outdated' },
    });
  });

  it('đơn nghỉ có lý do khi chưa đồng ý ⇒ 400 LEAVE_REASON_CONSENT_REQUIRED; lý do trống vẫn gửi; đồng ý ⇒ gửi được', async () => {
    const { send, asMia } = setup();
    const blocked = await send('POST', '/leave/requests', asMia, leave('Về quê'));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error?.code).toBe('LEAVE_REASON_CONSENT_REQUIRED');
    expect((await send('POST', '/leave/requests', asMia, leave('   '))).status).toBe(201);
    const consent = await send('PUT', '/me/privacy/consent', asMia, { leaveReason: true });
    expect(consent.body.data).toMatchObject({ consentLeaveReason: true });
    const withReason = await send('POST', '/leave/requests', asMia, {
      ...leave('Về quê'),
      startDate: '2026-10-20',
      endDate: '2026-10-20',
    });
    expect(withReason.status).toBe(201);
  });

  it('PATCH /company privacyContact (Admin) ⇒ hiện trong /me/privacy; chuỗi rỗng ⇒ xóa; giữ tên', async () => {
    const { api, send, asAdmin, asMia } = setup();
    const set = await send('PATCH', '/company', asAdmin, {
      privacyContact: '  Chị Lan — lan@example.com ',
      expectedVersion: 1,
    });
    expect(set.body.data).toEqual({
      name: api.db.company.name,
      version: 2,
      privacyContact: 'Chị Lan — lan@example.com',
    });
    expect((await send('GET', '/me/privacy', asMia)).body.data).toMatchObject({
      privacyContact: 'Chị Lan — lan@example.com',
    });
    const cleared = await send('PATCH', '/company', asAdmin, {
      privacyContact: '',
      expectedVersion: 2,
    });
    expect(cleared.body.data).toMatchObject({ privacyContact: null });
    expect(
      (await send('PATCH', '/company', asMia, { privacyContact: 'x', expectedVersion: 3 })).status,
    ).toBe(403);
  });
});
