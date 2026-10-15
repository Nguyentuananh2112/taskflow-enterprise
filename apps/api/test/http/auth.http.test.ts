// Route /api/v1/auth (data-and-api §2.4, security §1–2) trên composition root thật, lưu trữ InMemory.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { envelopeOf, errorOf } from '../support/http';
import {
  createTestApp,
  PASSWORD,
  refreshCookieOf,
  setCookieOf,
  WEB,
  type TestApp,
} from '../support/http-app';

let t: TestApp;
beforeEach(() => {
  t = createTestApp();
});

const post = (path: string) => request(t.app).post(`/api/v1/auth${path}`);

describe('POST /auth/register', () => {
  it('201: AuthTokenDto + user + defaultWorkspaceId, cookie refresh đúng thuộc tính, no-store', async () => {
    const res = await post('/register').send({
      email: ' Mia@Example.com ',
      password: PASSWORD,
      fullName: 'Mia',
    });
    expect(res.status).toBe(201);
    const data = envelopeOf<Record<string, unknown>>(res).data;
    expect(data).toMatchObject({
      accessToken: expect.any(String) as string,
      expiresIn: 900,
      user: { email: 'mia@example.com', fullName: 'Mia', createdAt: '2026-11-01T00:00:00.000Z' },
      defaultWorkspaceId: expect.any(String) as string,
    });
    expect(Object.keys(data ?? {}).sort()).toEqual([
      'accessToken',
      'defaultWorkspaceId',
      'expiresIn',
      'user',
    ]);
    const cookie = setCookieOf(res) ?? '';
    expect(cookie).toMatch(/^tf_rt=[A-Za-z0-9_-]{20,};/);
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=604800'); // 7 ngày trượt
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain('Domain');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('production (COOKIE_SECURE): tên __Secure-tf_rt + Secure', async () => {
    t = createTestApp({ cookieSecure: true });
    const res = await post('/register').send({
      email: 'a@example.com',
      password: PASSWORD,
      fullName: 'A',
    });
    const cookie = setCookieOf(res, '__Secure-tf_rt') ?? '';
    expect(cookie).toContain('Secure');
  });

  it('409 EMAIL_ALREADY_EXISTS khi trùng email (ADR-049)', async () => {
    await t.register('Mia');
    const res = await post('/register')
      .set('X-Forwarded-For', t.nextIp())
      .send({ email: 'MIA@example.com', password: PASSWORD, fullName: 'Mia 2' });
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it.each([
    [
      'mật khẩu < 12 ký tự',
      { email: 'x@example.com', password: 'short', fullName: 'X' },
      'password',
    ],
    [
      'mật khẩu phổ biến',
      { email: 'x@example.com', password: 'password123456', fullName: 'X' },
      'password',
    ],
    ['email sai', { email: 'not-an-email', password: PASSWORD, fullName: 'X' }, 'email'],
  ])('400 VALIDATION_ERROR: %s', async (_label, body, field) => {
    const res = await post('/register').send(body);
    expect(res.status).toBe(400);
    expect(errorOf(res).details?.issues?.some((i) => i.path[0] === field)).toBe(true);
  });

  it('SEC-57 mass assignment: field lạ (role, tokenVersion) ⇒ 400, không phản chiếu mật khẩu (ADR-096)', async () => {
    const res = await post('/register').send({
      email: 'x@example.com',
      password: 'hunter2-is-secret!',
      fullName: 'X',
      role: 'OWNER',
      tokenVersion: 9,
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).details?.issues?.map((i) => i.code)).toContain('unrecognized_keys');
    expect(JSON.stringify(res.body)).not.toContain('hunter2-is-secret!');
  });
});

describe('POST /auth/login', () => {
  it('200 + cookie; sai mật khẩu và email không tồn tại cùng một 401 INVALID_CREDENTIALS', async () => {
    const mia = await t.register('Mia');
    const ok = await post('/login')
      .set('X-Forwarded-For', mia.ip)
      .send({ email: mia.email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(envelopeOf<{ user: { id: string } }>(ok).data?.user.id).toBe(mia.id);
    expect(setCookieOf(ok)).toBeDefined();

    const wrong = await post('/login').send({ email: mia.email, password: 'wrong-password-1' });
    const ghost = await post('/login').send({
      email: 'ghost@example.com',
      password: 'wrong-password-1',
    });
    expect([wrong.status, ghost.status]).toEqual([401, 401]);
    expect(errorOf(wrong)).toEqual(errorOf(ghost));
    expect(errorOf(wrong).code).toBe('INVALID_CREDENTIALS');
  });

  it('rate limit: lần sai thứ 6 cùng (IP, email) trong 15 phút ⇒ 429 + Retry-After', async () => {
    const mia = await t.register('Mia');
    for (let i = 0; i < 5; i++) {
      expect(
        (await post('/login').send({ email: mia.email, password: 'wrong-password-1' })).status,
      ).toBe(401);
    }
    const res = await post('/login').send({ email: mia.email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(errorOf(res).code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('POST /auth/refresh & /auth/logout (cookie + Origin)', () => {
  it.each([
    ['thiếu Origin', undefined],
    ['Origin lạ', 'https://evil.example'],
  ])('%s ⇒ 403 ORIGIN_NOT_ALLOWED (trước khi đụng cookie)', async (_label, origin) => {
    const mia = await t.register('Mia');
    for (const path of ['/refresh', '/logout']) {
      const req = post(path).set('Cookie', mia.cookie).set('Content-Type', 'application/json');
      const res = await (origin ? req.set('Origin', origin) : req);
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('ORIGIN_NOT_ALLOWED');
    }
  });

  it('refresh hợp lệ ⇒ token mới + cookie xoay vòng; dùng lại cookie cũ (reuse) ⇒ 401 + xóa cookie', async () => {
    const mia = await t.register('Mia');
    const refresh = (cookie: string) =>
      post('/refresh')
        .set('Origin', WEB)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/json');

    const first = await refresh(mia.cookie);
    expect(first.status).toBe(200);
    expect(Object.keys(envelopeOf<object>(first).data ?? {}).sort()).toEqual([
      'accessToken',
      'expiresIn',
    ]);
    const rotated = refreshCookieOf(first);
    expect(rotated).not.toBe(mia.cookie);

    t.clock.advance(11_000); // quá cửa sổ ân hạn 10s ⇒ dùng lại token cũ là reuse
    const reuse = await refresh(mia.cookie);
    expect(reuse.status).toBe(401);
    expect(errorOf(reuse).code).toBe('REFRESH_TOKEN_INVALID');
    expect(setCookieOf(reuse)).toContain('Max-Age=0');
    // Reuse thu hồi cả family ⇒ cookie mới nhất cũng chết.
    expect((await refresh(rotated)).status).toBe(401);
  });

  it('refresh lần 2 trong 10s (2 tab) ⇒ 409 REFRESH_IN_PROGRESS, KHÔNG xóa cookie', async () => {
    const mia = await t.register('Mia');
    const refresh = () =>
      post('/refresh')
        .set('Origin', WEB)
        .set('Cookie', mia.cookie)
        .set('Content-Type', 'application/json');
    expect((await refresh()).status).toBe(200);
    const second = await refresh();
    expect(second.status).toBe(409);
    expect(errorOf(second).code).toBe('REFRESH_IN_PROGRESS');
    expect(setCookieOf(second)).toBeUndefined();
  });

  it('refresh không có cookie ⇒ 401 REFRESH_TOKEN_INVALID', async () => {
    const res = await post('/refresh').set('Origin', WEB).set('Content-Type', 'application/json');
    expect(res.status).toBe(401);
    expect(errorOf(res).code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('logout ⇒ 204 không body, xóa cookie, idempotent; refresh sau logout ⇒ 401', async () => {
    const mia = await t.register('Mia');
    const logout = () =>
      post('/logout')
        .set('Origin', WEB)
        .set('Cookie', mia.cookie)
        .set('Content-Type', 'application/json');
    const res = await logout();
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(setCookieOf(res)).toContain('Max-Age=0');
    expect((await logout()).status).toBe(204);
    expect(
      (
        await post('/refresh')
          .set('Origin', WEB)
          .set('Cookie', mia.cookie)
          .set('Content-Type', 'application/json')
      ).status,
    ).toBe(401);
  });
});

describe('Bearer: /auth/me, /auth/logout-all, /auth/change-password', () => {
  it('GET /me: user + memberships (workspace mặc định OWNER); thiếu/sai token ⇒ 401', async () => {
    const mia = await t.register('Mia');
    const me = await request(t.app).get('/api/v1/auth/me').set(mia.auth);
    expect(me.status).toBe(200);
    expect(
      envelopeOf<{ user: { id: string }; memberships: { workspaceId: string; role: string }[] }>(me)
        .data,
    ).toMatchObject({
      user: { id: mia.id },
      memberships: [{ workspaceId: mia.workspaceId, role: 'OWNER' }],
    });
    expect((await request(t.app).get('/api/v1/auth/me')).status).toBe(401);
    const garbage = await request(t.app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer garbage');
    expect(errorOf(garbage).code).toBe('UNAUTHORIZED');
  });

  it('token hết hạn ⇒ 401 TOKEN_EXPIRED (FE chỉ refresh với mã này)', async () => {
    const mia = await t.register('Mia');
    t.clock.advance(16 * 60_000);
    const res = await request(t.app).get('/api/v1/auth/me').set(mia.auth);
    expect(errorOf(res).code).toBe('TOKEN_EXPIRED');
  });

  it('PATCH /me: đổi họ tên (trim); field lạ (email) ⇒ 400 (ADR-083)', async () => {
    const mia = await t.register('Mia');
    const ok = await request(t.app)
      .patch('/api/v1/auth/me')
      .set(mia.auth)
      .send({ fullName: '  Mia Nguyen ' });
    expect(envelopeOf<{ fullName: string }>(ok).data?.fullName).toBe('Mia Nguyen');
    const bad = await request(t.app)
      .patch('/api/v1/auth/me')
      .set(mia.auth)
      .send({ fullName: 'X', email: 'evil@example.com' });
    expect(bad.status).toBe(400);
  });

  it('logout-all ⇒ 204, access token cũ hết hiệu lực (tv), refresh cookie chết', async () => {
    const mia = await t.register('Mia');
    const res = await request(t.app)
      .post('/api/v1/auth/logout-all')
      .set(mia.auth)
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(204);
    expect((await request(t.app).get('/api/v1/auth/me').set(mia.auth)).status).toBe(401);
    expect(
      (
        await post('/refresh')
          .set('Origin', WEB)
          .set('Cookie', mia.cookie)
          .set('Content-Type', 'application/json')
      ).status,
    ).toBe(401);
  });

  it('change-password: sai mật khẩu cũ ⇒ 400 INVALID_CURRENT_PASSWORD (không 401); đúng ⇒ token mới, token cũ chết', async () => {
    const mia = await t.register('Mia');
    const change = (currentPassword: string) =>
      request(t.app)
        .post('/api/v1/auth/change-password')
        .set(mia.auth)
        .send({ currentPassword, newPassword: 'brand-new-pass-99' });
    const wrong = await change('not-my-password');
    expect(wrong.status).toBe(400);
    expect(errorOf(wrong).code).toBe('INVALID_CURRENT_PASSWORD');

    const ok = await change(PASSWORD);
    expect(ok.status).toBe(200);
    const fresh = envelopeOf<{ accessToken: string }>(ok).data?.accessToken ?? '';
    expect(setCookieOf(ok)).toBeDefined();
    expect((await request(t.app).get('/api/v1/auth/me').set(mia.auth)).status).toBe(401);
    expect(
      (await request(t.app).get('/api/v1/auth/me').set('Authorization', `Bearer ${fresh}`)).status,
    ).toBe(200);
  });
});
