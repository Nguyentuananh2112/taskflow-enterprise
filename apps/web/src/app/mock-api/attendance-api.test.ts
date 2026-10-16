import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';

// Mock chấm công (T-041a) phải khó tính như API thật sẽ làm (mã lỗi đã chốt với A — T-038).

const BASE = 'http://localhost:4000/api/v1';
const ORIGIN = 'http://localhost:4000';
// Thứ 5, 2026-10-15 03:00Z = 10:00 giờ Việt Nam (ngày làm, sau 08:00).
let now = Date.parse('2026-10-15T03:00:00.000Z');

type Json = {
  data: Record<string, unknown> & { days?: Array<Record<string, unknown>> };
  error: { code: string; details: Record<string, unknown> };
};

function setup() {
  now = Date.parse('2026-10-15T03:00:00.000Z');
  const api = createMockApi(BASE, { now: () => now });
  const send = async (
    method: string,
    path: string,
    token?: string,
    headers: Record<string, string> = {},
  ) => {
    const request = new Request(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
    const response = await getResponse(api.handlers, request);
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Json };
  };
  const register = async (email: string) => {
    const request = new Request(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password: 'cay-tre-xanh-ven-song', fullName: 'Trần Lan' }),
    });
    const response = await getResponse(api.handlers, request);
    const body = (await response?.json()) as {
      data: { accessToken: string; user: { id: string }; defaultWorkspaceId: string };
    };
    return body.data;
  };
  return { api, send, register };
}

const key = () => crypto.randomUUID();
const path = (ws: string, p: string) => `/workspaces/${ws}/attendance${p}`;

describe('mock chấm công', () => {
  it('hôm nay: serverNow, múi giờ, ngày làm, PENDING trước khi vào; Vào ⇒ PRESENT + inProgress; Ra ⇒ hết inProgress', async () => {
    const { send, register } = setup();
    now = Date.parse('2026-10-15T09:50:00.000Z'); // 16:50 giờ VN; đăng ký SAU khi đặt giờ (token còn hạn)
    const lan = await register('lan@example.com');
    const ws = lan.defaultWorkspaceId;
    const today = await send('GET', path(ws, '/me/today'), lan.accessToken);
    expect(today.status).toBe(200);
    expect(today.body.data).toMatchObject({
      serverNow: '2026-10-15T09:50:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      date: '2026-10-15',
      isWorkday: true,
      status: 'PENDING',
      firstIn: null,
    });
    const inn = await send('POST', path(ws, '/check-in'), lan.accessToken, {
      'idempotency-key': key(),
    });
    expect(inn.status).toBe(200);
    expect(inn.body.data).toMatchObject({ status: 'PRESENT', inProgress: true, late: true });
    now += 10 * 60_000; // 17:00 — trước giờ kết thúc 17:30 ⇒ về sớm
    const out = await send('POST', path(ws, '/check-out'), lan.accessToken, {
      'idempotency-key': key(),
    });
    expect(out.body.data).toMatchObject({ inProgress: false, early: true });
  });

  it('Idempotency-Key: thiếu ⇒ 400; lặp cùng key ⇒ 200 không tạo lượt mới; key của IN dùng cho OUT ⇒ 422', async () => {
    const { send, register, api } = setup();
    const lan = await register('lan@example.com');
    const ws = lan.defaultWorkspaceId;
    expect((await send('POST', path(ws, '/check-in'), lan.accessToken)).status).toBe(400);
    const k = key();
    await send('POST', path(ws, '/check-in'), lan.accessToken, { 'idempotency-key': k });
    const again = await send('POST', path(ws, '/check-in'), lan.accessToken, {
      'idempotency-key': k,
    });
    expect(again.status).toBe(200);
    expect(api.attendance.punches(ws, lan.user.id, '2026-10-15')).toHaveLength(1);
    const reused = await send('POST', path(ws, '/check-out'), lan.accessToken, {
      'idempotency-key': k,
    });
    expect(reused.status).toBe(422);
    expect(reused.body.error.details).toEqual({ rule: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('IN lần 2 (key mới) ⇒ 409 already_checked_in; OUT khi chưa IN ⇒ 422 NOT_CHECKED_IN', async () => {
    const { send, register } = setup();
    const lan = await register('lan@example.com');
    const ws = lan.defaultWorkspaceId;
    const out = await send('POST', path(ws, '/check-out'), lan.accessToken, {
      'idempotency-key': key(),
    });
    expect(out.status).toBe(422);
    expect(out.body.error.details).toEqual({ rule: 'NOT_CHECKED_IN' });
    await send('POST', path(ws, '/check-in'), lan.accessToken, { 'idempotency-key': key() });
    const twice = await send('POST', path(ws, '/check-in'), lan.accessToken, {
      'idempotency-key': key(),
    });
    expect(twice.status).toBe(409);
    expect(twice.body.error.details).toEqual({ reason: 'already_checked_in' });
  });

  it('VIEWER ⇒ 403 attendance:self; người ngoài ⇒ 404 workspace', async () => {
    const { send, register, api } = setup();
    const lan = await register('lan@example.com');
    const vic = await register('vic@example.com');
    const ws = lan.defaultWorkspaceId;
    const membership = api.db.membershipIn(lan.user.id, ws);
    if (!membership) throw new Error('thiếu membership');
    const outsider = await send('GET', path(ws, '/me/today'), vic.accessToken);
    expect(outsider.status).toBe(404);
    api.db.setMembership(vic.user.id, membership, 'VIEWER');
    const viewer = await send('GET', path(ws, '/me/today'), vic.accessToken);
    expect(viewer.status).toBe(403);
    expect(viewer.body.error.details).toEqual({ required: 'attendance:self' });
  });

  it('tháng: đủ mọi ngày; ngày làm đã qua không chấm ⇒ ABSENT; Chủ nhật ⇒ OFF; tương lai ⇒ PENDING', async () => {
    const { send, register } = setup();
    const lan = await register('lan@example.com');
    const month = await send(
      'GET',
      path(lan.defaultWorkspaceId, '/me?month=2026-10'),
      lan.accessToken,
    );
    const days = month.body.data.days ?? [];
    expect(days).toHaveLength(31);
    expect(days[13]).toMatchObject({ date: '2026-10-14', status: 'ABSENT' }); // thứ 4
    expect(days[10]).toMatchObject({ date: '2026-10-11', status: 'OFF' }); // chủ nhật
    expect(days[19]).toMatchObject({ date: '2026-10-20', status: 'PENDING' });
  });
});
