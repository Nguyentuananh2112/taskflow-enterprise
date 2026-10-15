import { getResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { createMockApi } from './index';
import { isMockApiEnabled } from './mock-flag';
import { REFRESH_GRACE_MS } from './mock-db';

// Mock phải "khó tính" như server thật (T-019 việc 1): validate bằng schema contracts, đúng mã lỗi,
// đúng vòng đời refresh token.

const BASE = 'http://localhost:4000/api/v1';

/** Dạng JSON đủ dùng cho assertion (mock đã tự parse bằng schema contracts trước khi trả). */
type Body = {
  data: { accessToken: string; memberships: Array<{ role: string }> };
  error: { code: string; details: { issues: Array<{ path: unknown[]; code: string }> } };
};
let now = Date.parse('2026-10-15T03:00:00.000Z');
afterEach(() => {
  now = Date.parse('2026-10-15T03:00:00.000Z');
});

function setup(accessTtlSec = 900) {
  const api = createMockApi(BASE, { accessTtlSec, now: () => now });
  const send = async (
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ) => {
    const request = new Request(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const response = await getResponse(api.handlers, request);
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    const text = await response.text();
    const cookie = response.headers.get('set-cookie')?.match(/tf_rt=([^;]*)/)?.[1];
    return {
      status: response.status,
      body: text ? (JSON.parse(text) as Body) : null,
      cookie,
    };
  };
  const register = (email = 'lan@example.com') =>
    send('POST', '/auth/register', {
      body: { email, password: 'cay-tre-xanh-ven-song', fullName: 'Trần Lan' },
    });
  return { api, send, register };
}

describe('validate request bằng schema contracts', () => {
  it('mật khẩu 11 ký tự ⇒ 400 VALIDATION_ERROR theo path, issue KHÔNG chứa input (ADR-096)', async () => {
    const { send } = setup();
    const res = await send('POST', '/auth/register', {
      body: { email: 'lan@example.com', password: 'mat-khau-11', fullName: 'Trần Lan' },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error.code).toBe('VALIDATION_ERROR');
    expect(res.body?.error.details.issues).toEqual([
      expect.objectContaining({ path: ['password'] }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('mat-khau-11');
  });

  it('field lạ (strictObject) ⇒ 400 unrecognized_keys', async () => {
    const { send } = setup();
    const res = await send('POST', '/auth/login', {
      body: { email: 'lan@example.com', password: 'x', isAdmin: true },
    });
    expect(res.body?.error.details.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('email được chuẩn hóa như server (trim + lowercase) ⇒ trùng ⇒ 409 EMAIL_ALREADY_EXISTS', async () => {
    const { register } = setup();
    await register('lan@example.com');
    const dup = await register('  LAN@Example.com ');
    expect(dup.status).toBe(409);
    expect(dup.body?.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('mật khẩu phổ biến ⇒ VALIDATION_ERROR tại password (luật chỉ server biết)', async () => {
    const { send } = setup();
    const res = await send('POST', '/auth/register', {
      body: { email: 'an@example.com', password: 'password1234', fullName: 'An' },
    });
    expect(res.body?.error.details.issues[0]?.path).toEqual(['password']);
  });
});

describe('vòng đời phiên giống server thật', () => {
  it('register ⇒ 201 + cookie HttpOnly Path=/api/v1/auth; /auth/me với Bearer', async () => {
    const { register, send } = setup();
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.cookie).toMatch(/^mock-rt-/);
    const me = await send('GET', '/auth/me', {
      headers: { authorization: `Bearer ${res.body?.data.accessToken}` },
    });
    expect(me.body?.data.memberships[0]?.role).toBe('OWNER');
  });

  it('access token hết hạn ⇒ TOKEN_EXPIRED (khác UNAUTHORIZED)', async () => {
    const { register, send } = setup(60);
    const token = (await register()).body?.data.accessToken as string;
    now += 61_000;
    const res = await send('GET', '/auth/me', { headers: { authorization: `Bearer ${token}` } });
    expect(res.body?.error.code).toBe('TOKEN_EXPIRED');
  });

  it('refresh xoay vòng; dùng lại token cũ trong 10s ⇒ 409; sau 10s ⇒ reuse ⇒ thu hồi cả family', async () => {
    const { register, send } = setup();
    const first = (await register()).cookie as string;
    const rotated = await send('POST', '/auth/refresh', { headers: { cookie: `tf_rt=${first}` } });
    expect(rotated.status).toBe(200);
    const second = rotated.cookie as string;

    const replay = await send('POST', '/auth/refresh', { headers: { cookie: `tf_rt=${first}` } });
    expect(replay.body?.error.code).toBe('REFRESH_IN_PROGRESS');

    now += REFRESH_GRACE_MS + 1;
    const reuse = await send('POST', '/auth/refresh', { headers: { cookie: `tf_rt=${first}` } });
    expect(reuse.body?.error.code).toBe('REFRESH_TOKEN_INVALID');
    const victim = await send('POST', '/auth/refresh', { headers: { cookie: `tf_rt=${second}` } });
    expect(victim.body?.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('logout-all ⇒ access token cũ thành UNAUTHORIZED, refresh cũ hết hiệu lực', async () => {
    const { register, send } = setup();
    const res = await register();
    const auth = { authorization: `Bearer ${res.body?.data.accessToken}` };
    expect((await send('POST', '/auth/logout-all', { headers: auth })).status).toBe(204);
    expect((await send('GET', '/auth/me', { headers: auth })).body?.error.code).toBe(
      'UNAUTHORIZED',
    );
    const refresh = await send('POST', '/auth/refresh', {
      headers: { cookie: `tf_rt=${res.cookie}` },
    });
    expect(refresh.body?.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('5 lần đăng nhập sai ⇒ 429 RATE_LIMITED kèm retryAfterSec', async () => {
    const { register, send } = setup();
    await register();
    for (let i = 0; i < 5; i += 1) {
      await send('POST', '/auth/login', { body: { email: 'lan@example.com', password: 'sai' } });
    }
    const res = await send('POST', '/auth/login', {
      body: { email: 'lan@example.com', password: 'cay-tre-xanh-ven-song' },
    });
    expect(res.status).toBe(429);
    expect(res.body?.error.details).toEqual({ retryAfterSec: 60 });
  });

  it('đổi mật khẩu sai mật khẩu cũ ⇒ 400 INVALID_CURRENT_PASSWORD (không phải 401)', async () => {
    const { register, send } = setup();
    const res = await register();
    const out = await send('POST', '/auth/change-password', {
      headers: { authorization: `Bearer ${res.body?.data.accessToken}` },
      body: { currentPassword: 'khong-dung-dau', newPassword: 'mat-khau-moi-rat-dai' },
    });
    expect(out.status).toBe(400);
    expect(out.body?.error.code).toBe('INVALID_CURRENT_PASSWORD');
  });
});

describe('cờ APP_MOCK_API', () => {
  it.each([
    [{ APP_MOCK_API: '1', APP_ENV: 'local' }, true],
    [{ APP_MOCK_API: '1', APP_ENV: 'test' }, true],
    [{ APP_MOCK_API: '1', APP_ENV: 'staging' }, false],
    [{ APP_MOCK_API: '1', APP_ENV: 'production' }, false],
    [{ APP_MOCK_API: 'true', APP_ENV: 'local' }, false],
    [{ APP_ENV: 'local' }, false],
  ])('%j ⇒ %s', (env, expected) => {
    expect(isMockApiEnabled(env)).toBe(expected);
  });
});
