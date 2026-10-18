// T-075 — thông báo quyền riêng tư qua route thật (data-retention.md §5; TL chốt thay Q3/Q4 R27): GET / ack theo
// phiên bản / consent lý do nghỉ; Admin cũng có; người đã rời ⇒ 401; đơn nghỉ có `reason` khi chưa đồng ý ⇒ 400.
import { PRIVACY_NOTICE_VERSION, PrivacyConsentResultDto, PrivacyDto } from '@taskflow/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let olivia: TestUser;
let mia: TestUser;

beforeEach(async () => {
  t = createTestApp();
  olivia = await t.register('Olivia', undefined, { role: 'ADMIN' });
  mia = await t.register('Mia');
  await t.persistence.company.company.ensure('Công ty Mẫu', t.clock.now());
});

const privacy = async (by: TestUser) => {
  const res = await request(t.app).get('/api/v1/me/privacy').set(by.auth);
  expect(res.status).toBe(200);
  return PrivacyDto.strict().parse(envelopeOf(res).data);
};
const send = (by: TestUser, method: 'post' | 'put', path: string, body: object) =>
  request(t.app)
    [method](`/api/v1/me/privacy${path}`)
    .set(by.auth)
    .set('Content-Type', 'application/json')
    .send(body);
const submitLeave = (by: TestUser, reason?: string) =>
  request(t.app)
    .post('/api/v1/leave/requests')
    .set(by.auth)
    .send({
      type: 'ANNUAL',
      startDate: '2026-11-23',
      endDate: '2026-11-23',
      ...(reason !== undefined ? { reason } : {}),
    });

describe('GET / POST ack /me/privacy', () => {
  it('chưa xác nhận ⇒ needsAck; ack đúng phiên bản ⇒ ackVersion + ackedAt; bên kiểm soát = tên công ty, đầu mối null', async () => {
    const before = await privacy(mia);
    expect(before).toMatchObject({
      version: PRIVACY_NOTICE_VERSION,
      ackVersion: null,
      needsAck: true,
      consentLeaveReason: false,
      companyName: 'Công ty Mẫu',
      privacyContact: null,
    });
    const acked = await send(mia, 'post', '/ack', { version: PRIVACY_NOTICE_VERSION });
    expect(acked.status).toBe(200);
    expect(PrivacyDto.parse(envelopeOf(acked).data)).toMatchObject({
      ackVersion: PRIVACY_NOTICE_VERSION,
      ackedAt: t.clock.now().toISOString(),
      needsAck: false,
    });
    expect((await privacy(olivia)).needsAck).toBe(true); // của ai người nấy (Admin cũng phải xác nhận)
  });

  it('ack phiên bản khác bản hiện hành ⇒ 409 privacy_version_outdated, không ghi; body sai ⇒ 400', async () => {
    const stale = await send(mia, 'post', '/ack', { version: PRIVACY_NOTICE_VERSION + 1 });
    expect([stale.status, errorOf(stale).details]).toEqual([
      409,
      { reason: 'privacy_version_outdated' },
    ]);
    expect((await privacy(mia)).ackVersion).toBeNull();
    expect((await send(mia, 'post', '/ack', {})).status).toBe(400);
  });

  it('đầu mối của công ty hiện trong thông báo; không token ⇒ 401; rời công ty ⇒ 401 SESSION_REVOKED', async () => {
    await t.persistence.company.company.update({
      privacyContact: 'dpo@cty.vn',
      expectedVersion: 1,
      at: t.clock.now(),
    });
    expect((await privacy(mia)).privacyContact).toBe('dpo@cty.vn');
    expect((await request(t.app).get('/api/v1/me/privacy')).status).toBe(401);
    t.companyStore.removeMember(mia.id);
    const gone = await request(t.app).get('/api/v1/me/privacy').set(mia.auth);
    expect([gone.status, errorOf(gone).code]).toEqual([401, 'SESSION_REVOKED']);
  });
});

const ruleOf = (res: request.Response) => (errorOf(res).details as { rule?: string } | null)?.rule;
const mineReasons = async (by: TestUser) =>
  new Map(
    (
      envelopeOf<{ id: string; reason: string | null }[]>(
        await request(t.app).get('/api/v1/leave/requests?mine=1').set(by.auth),
      ).data ?? []
    ).map((r) => [r.id, r.reason]),
  );

describe('PUT /me/privacy/consent + đơn nghỉ có lý do (Q3)', () => {
  it('chưa đồng ý: đơn CÓ lý do ⇒ 422 rule LEAVE_REASON_CONSENT_REQUIRED, không tạo đơn; KHÔNG lý do ⇒ 201', async () => {
    const blocked = await submitLeave(mia, 'Khám răng');
    expect([blocked.status, errorOf(blocked).code, ruleOf(blocked)]).toEqual([
      422,
      'BUSINESS_RULE_VIOLATION',
      'LEAVE_REASON_CONSENT_REQUIRED',
    ]);
    expect((await submitLeave(mia, '   ')).status).toBe(201); // chỉ khoảng trắng = không có lý do
  });

  it('rút lại ⇒ lý do của đơn ĐANG CHỜ bị xóa (đếm trong response), đơn đã duyệt giữ (D3); gửi lý do lại ⇒ 422', async () => {
    const on = await send(mia, 'put', '/consent', { leaveReason: true });
    expect(PrivacyConsentResultDto.parse(envelopeOf(on).data)).toMatchObject({
      consentLeaveReason: true,
      consentLeaveReasonAt: t.clock.now().toISOString(),
      clearedPendingReasons: 0,
    });
    const pending = envelopeOf<{ id: string }>(await submitLeave(mia, 'Khám răng')).data?.id ?? '';
    const decided =
      envelopeOf<{ id: string }>(
        await request(t.app).post('/api/v1/leave/requests').set(mia.auth).send({
          type: 'ANNUAL',
          startDate: '2026-11-25',
          endDate: '2026-11-25',
          reason: 'Đi cưới',
        }),
      ).data?.id ?? '';
    await request(t.app)
      .post(`/api/v1/leave/requests/${decided}/approve`)
      .set(olivia.auth)
      .send({ expectedVersion: 1 })
      .expect(200);

    const off = await send(mia, 'put', '/consent', { leaveReason: false });
    expect(PrivacyConsentResultDto.parse(envelopeOf(off).data)).toMatchObject({
      consentLeaveReason: false,
      clearedPendingReasons: 1,
    });
    const reasons = await mineReasons(mia);
    expect([reasons.get(pending), reasons.get(decided)]).toEqual([null, 'Đi cưới']);
    expect(ruleOf(await submitLeave(mia, 'Lần 2'))).toBe('LEAVE_REASON_CONSENT_REQUIRED');
  });

  it('bằng chứng: mỗi lần ĐỔI thêm một sự kiện chỉ-thêm (kèm phiên bản thông báo); ack lặp / đồng ý lặp không thêm, giữ thời điểm đầu', async () => {
    await send(mia, 'post', '/ack', { version: PRIVACY_NOTICE_VERSION });
    const firstAck = (await privacy(mia)).ackedAt;
    t.clock.advance(60_000);
    await send(mia, 'post', '/ack', { version: PRIVACY_NOTICE_VERSION });
    expect((await privacy(mia)).ackedAt).toBe(firstAck);
    await send(mia, 'put', '/consent', { leaveReason: true });
    await send(mia, 'put', '/consent', { leaveReason: true });
    await send(mia, 'put', '/consent', { leaveReason: false });
    const store = t.persistence.auth.privacy as unknown as {
      events(): { userId: string; kind: string; value: boolean; noticeVersion: number }[];
    };
    expect(
      store
        .events()
        .filter((e) => e.userId === mia.id)
        .map((e) => [e.kind, e.value, e.noticeVersion]),
    ).toEqual([
      ['ACK', true, PRIVACY_NOTICE_VERSION],
      ['LEAVE_REASON', true, PRIVACY_NOTICE_VERSION],
      ['LEAVE_REASON', false, PRIVACY_NOTICE_VERSION],
    ]);
  });

  it('body sai ⇒ 400', async () => {
    expect((await send(mia, 'put', '/consent', { leaveReason: 'có' })).status).toBe(400);
  });
});
