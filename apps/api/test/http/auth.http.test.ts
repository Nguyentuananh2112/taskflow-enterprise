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

/** Admin (in-process) thêm nhân viên qua route thật ⇒ token kích hoạt (một lần trong response). */
async function hire(email = 'mia@example.com', fullName = 'Mia') {
  const admin = await t.register('Olivia', 'olivia@example.com', {
    role: 'ADMIN',
    workspace: false,
  });
  const res = await request(t.app)
    .post('/api/v1/hr/employees')
    .set(admin.auth)
    .send({ email, fullName });
  expect(res.status).toBe(201);
  const data = envelopeOf<{
    employee: { userId: string; status: string };
    activation: { token: string; link: string; expiresAt: string } | null;
  }>(res).data;
  return { admin, res, data, token: data?.activation?.token ?? '' };
}
const activate = (token: string, password = PASSWORD) =>
  post('/activate').set('Origin', WEB).set('X-Forwarded-For', t.nextIp()).send({ token, password });

describe('Mốc 3.5 (ADR-137): không còn tự đăng ký', () => {
  it('POST /auth/register ⇒ 404', async () => {
    const res = await post('/register').send({
      email: 'x@example.com',
      password: PASSWORD,
      fullName: 'X',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /hr/employees ⇒ POST /auth/activate (ADR-137)', () => {
  it('201: tài khoản chờ kích hoạt + link `#t=` 7 ngày, no-store; token chỉ có trong response này', async () => {
    const { res, data, token } = await hire();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(data).toMatchObject({
      employee: { status: 'PENDING_ACTIVATION', version: 1 },
      accountCreated: true,
      activation: { link: `${WEB}/activate#t=${token}` },
    });
    expect(new Date(data?.activation?.expiresAt ?? 0).getTime() - t.clock.now().getTime()).toBe(
      7 * 24 * 3600 * 1000,
    );
  });

  it('chờ kích hoạt: login mọi mật khẩu ⇒ 401 INVALID_CREDENTIALS như không có user (SEC-HR-58)', async () => {
    await hire();
    for (const password of [PASSWORD, '', 'whatever-long-pass']) {
      const res = await post('/login')
        .set('X-Forwarded-For', t.nextIp())
        .send({ email: 'mia@example.com', password });
      expect([res.status, errorOf(res).code]).toEqual(
        password === '' ? [400, 'VALIDATION_ERROR'] : [401, 'INVALID_CREDENTIALS'],
      );
    }
  });

  it('inspect chỉ đọc: tên + email + công ty; xem nhiều lần token vẫn dùng được (bot xem trước link)', async () => {
    const { token } = await hire();
    for (let i = 0; i < 3; i += 1) {
      const res = await post('/activation/inspect')
        .set('Origin', WEB)
        .set('X-Forwarded-For', t.nextIp())
        .send({ token });
      expect(res.status).toBe(200);
      expect(envelopeOf(res).data).toEqual({
        fullName: 'Mia',
        email: 'mia@example.com',
        companyName: null,
      });
    }
    expect((await activate(token)).status).toBe(200);
  });

  it('mật khẩu yếu ⇒ 400 path password, không phản chiếu mật khẩu, token VẪN sống', async () => {
    const { token } = await hire();
    for (const password of ['short', 'password123456', 'mia-is-my-password']) {
      const res = await activate(token, password);
      expect(res.status, password).toBe(400);
      expect(errorOf(res).details?.issues?.some((i) => i.path[0] === 'password')).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(password);
    }
    expect((await activate(token)).status).toBe(200);
  });

  it('200: phiên mới như login (cookie refresh đúng thuộc tính, no-store); dùng lại ⇒ 410; token lạ ⇒ 400', async () => {
    const { token } = await hire();
    const res = await activate(token);
    expect(res.status).toBe(200);
    expect(envelopeOf(res).data).toMatchObject({
      accessToken: expect.any(String) as string,
      expiresIn: 900,
      user: { email: 'mia@example.com', fullName: 'Mia' },
    });
    const cookie = setCookieOf(res) ?? '';
    expect(cookie).toMatch(/^tf_rt=[A-Za-z0-9_-]{20,};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(res.headers['cache-control']).toBe('no-store');

    expect(errorOf(await activate(token)).code).toBe('ACTIVATION_GONE');
    expect((await activate(token)).status).toBe(410);
    expect(errorOf(await activate('A'.repeat(43))).code).toBe('ACTIVATION_INVALID');
    // Đã kích hoạt ⇒ đăng nhập được bằng mật khẩu vừa đặt.
    const login = await post('/login')
      .set('X-Forwarded-For', t.nextIp())
      .send({ email: 'mia@example.com', password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('activate / inspect cần Origin cho phép (403 ORIGIN_NOT_ALLOWED); body lạ ⇒ 400', async () => {
    const { token } = await hire();
    const noOrigin = await post('/activate').send({ token, password: PASSWORD });
    expect(errorOf(noOrigin).code).toBe('ORIGIN_NOT_ALLOWED');
    const extra = await post('/activate')
      .set('Origin', WEB)
      .send({ token, password: PASSWORD, userId: 'x' });
    expect(extra.status).toBe(400);
  });

  it('SEC-40: 5 lần thêm song song cùng email ⇒ đúng một 201, còn lại 409 already_employee', async () => {
    const admin = await t.register('Olivia', 'olivia@example.com', {
      role: 'ADMIN',
      workspace: false,
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(t.app)
          .post('/api/v1/hr/employees')
          .set(admin.auth)
          .send({ email: 'twin@example.com', fullName: 'Song Sinh' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(errorOf(r)).toMatchObject({
        code: 'RESOURCE_CONFLICT',
        details: { reason: 'already_employee', field: 'email' },
      });
    }
  });

  it('nhân viên thường (không hr:manage) thêm ⇒ 403; người đã rời công ty ⇒ 401 SESSION_REVOKED', async () => {
    const mia = await t.register('Mia', undefined, { workspace: false });
    const body = { email: 'new@example.com', fullName: 'New' };
    const forbidden = await request(t.app).post('/api/v1/hr/employees').set(mia.auth).send(body);
    expect(forbidden.status).toBe(403);
    t.companyStore.removeMember(mia.id);
    const revoked = await request(t.app).post('/api/v1/hr/employees').set(mia.auth).send(body);
    expect([revoked.status, errorOf(revoked).code]).toEqual([401, 'SESSION_REVOKED']);
  });
});

describe('cổng công ty ở login / refresh / me (Mốc 3.5, B HIGH-2)', () => {
  it('rời công ty ⇒ login 401 INVALID_CREDENTIALS; refresh 401 SESSION_REVOKED + xóa cookie, không xoay (SEC-HR-69)', async () => {
    const mia = await t.register('Mia');
    t.companyStore.removeMember(mia.id);
    const login = await post('/login')
      .set('X-Forwarded-For', t.nextIp())
      .send({ email: mia.email, password: PASSWORD });
    expect([login.status, errorOf(login).code]).toEqual([401, 'INVALID_CREDENTIALS']);
    const refresh = await post('/refresh')
      .set('Origin', WEB)
      .set('Content-Type', 'application/json')
      .set('Cookie', mia.cookie);
    expect([refresh.status, errorOf(refresh).code]).toEqual([401, 'SESSION_REVOKED']);
    expect(setCookieOf(refresh)).toMatch(/^tf_rt=;/);
    const me = await request(t.app).get('/api/v1/auth/me').set(mia.auth);
    expect([me.status, errorOf(me).code]).toEqual([401, 'SESSION_REVOKED']);
  });

  it('quá access_until (job chưa chạy) ⇒ refresh 401 SESSION_REVOKED dù refresh token còn hạn', async () => {
    const mia = await t.register('Mia');
    const m = await t.companyStore.find(mia.id);
    t.companyStore.upsertMember({
      ...m!,
      offboardLastDay: '2026-10-31',
      offboardAccessUntil: new Date(t.businessClock.now().getTime() - 1),
      offboardScheduledById: mia.id,
    });
    const refresh = await post('/refresh')
      .set('Origin', WEB)
      .set('Content-Type', 'application/json')
      .set('Cookie', mia.cookie);
    expect([refresh.status, errorOf(refresh).code]).toEqual([401, 'SESSION_REVOKED']);
  });

  it('/auth/me có company {name, role, grants, permissions, status, offboardLastDay}', async () => {
    const hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'] });
    const me = await request(t.app).get('/api/v1/auth/me').set(hana.auth);
    expect(me.status).toBe(200);
    expect(envelopeOf<{ company: unknown }>(me).data?.company).toEqual({
      name: null,
      role: 'EMPLOYEE',
      grants: ['HR_MANAGE'],
      permissions: [
        'attendance:self',
        'hr:manage',
        'leave:self',
        'profile:self',
        'workspace:create',
      ],
      status: 'ACTIVE',
      offboardLastDay: null,
    });
  });
});

describe('cookie production (COOKIE_SECURE, ADR-109)', () => {
  it('__Host-tf_rt; Secure; HttpOnly; SameSite=Strict; Path=/; không Domain', async () => {
    t = createTestApp({ cookieSecure: true });
    await t.register('A', 'a@example.com', { workspace: false });
    const res = await post('/login')
      .set('X-Forwarded-For', t.nextIp())
      .send({ email: 'a@example.com', password: PASSWORD });
    const cookie = setCookieOf(res, '__Host-tf_rt') ?? '';
    expect(cookie).toMatch(/^__Host-tf_rt=[^;]+;/);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toMatch(/Path=\/(;|$)/);
    expect(cookie).not.toContain('Domain');
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

  const wrongFrom = (ip: string, email: string) =>
    post('/login').set('X-Forwarded-For', ip).send({ email, password: 'wrong-password-1' });

  it('rate limit (ADR-108): lần sai thứ 11 cùng (IP, email) trong 15 phút ⇒ 429 + Retry-After; IP khác không bị ảnh hưởng', async () => {
    const mia = await t.register('Mia');
    const attacker = t.nextIp();
    for (let i = 0; i < 10; i++) expect((await wrongFrom(attacker, mia.email)).status).toBe(401);
    const res = await post('/login')
      .set('X-Forwarded-For', attacker)
      .send({ email: mia.email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(errorOf(res).code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    const owner = await post('/login')
      .set('X-Forwarded-For', mia.ip)
      .send({ email: mia.email, password: PASSWORD });
    expect(owner.status).toBe(200);
  });

  it('ADR-108 (M4): 10 IP gửi sai ⇒ chủ tài khoản vẫn đăng nhập được từ IP của mình cho tới ngưỡng email (100/giờ)', async () => {
    const mia = await t.register('Mia');
    const attackers = Array.from({ length: 10 }, () => t.nextIp());
    for (const ip of attackers) {
      for (let i = 0; i < 9; i++) expect((await wrongFrom(ip, mia.email)).status).toBe(401);
    }
    const login = () =>
      post('/login').set('X-Forwarded-For', mia.ip).send({ email: mia.email, password: PASSWORD });
    expect((await login()).status).toBe(200); // 90 lần sai — dưới ngưỡng email
    for (let i = 0; i < 10; i++) expect((await wrongFrom(t.nextIp(), mia.email)).status).toBe(401);
    expect((await login()).status).toBe(429); // đủ 100 lần sai theo email ⇒ chặn (rủi ro chấp nhận)
  });

  it('ADR-108: body sai định dạng (400) KHÔNG bị đếm vào limiter theo email / (IP, email)', async () => {
    const mia = await t.register('Mia');
    const ip = t.nextIp();
    const malformed = () =>
      post('/login').set('X-Forwarded-For', ip).send({ email: mia.email, password: '' });
    for (let i = 0; i < 15; i++) expect((await malformed()).status).toBe(400);
    const ok = await post('/login')
      .set('X-Forwarded-For', ip)
      .send({ email: mia.email, password: PASSWORD });
    expect(ok.status).toBe(200);
  });
});

describe('JWT_ACCESS_TTL_SECONDS (APP_ENV=test — E2E-11)', () => {
  const lifetimeOf = (token: string) => {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { iat: number; exp: number };
    return payload.exp - payload.iat;
  };

  it('mặc định token sống 900 giây; cấu hình 5 ⇒ token sống 5 giây', async () => {
    expect(lifetimeOf((await t.register('Mia')).token)).toBe(900);
    t = createTestApp({ jwtAccessTtlSeconds: 5 });
    expect(lifetimeOf((await t.register('Pam')).token)).toBe(5);
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
    // F3 B-5: thiết bị đang dùng cũng phải bỏ cookie refresh (đã chết) — không giữ cookie rác.
    expect(setCookieOf(res)).toMatch(/tf_rt=;.*Max-Age=0/);
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

  it('F3 B-6: change-password body có field lạ ⇒ 400 VALIDATION_ERROR (schema strict chạy TRƯỚC use case), mật khẩu không đổi', async () => {
    const mia = await t.register('Mia');
    const res = await request(t.app)
      .post('/api/v1/auth/change-password')
      .set(mia.auth)
      .send({ currentPassword: PASSWORD, newPassword: 'brand-new-pass-99', tokenVersion: 0 });
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    // Use case không chạy ⇒ token cũ còn sống, mật khẩu cũ vẫn đăng nhập được.
    expect((await request(t.app).get('/api/v1/auth/me').set(mia.auth)).status).toBe(200);
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
