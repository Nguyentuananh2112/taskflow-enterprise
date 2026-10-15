// T-028 (finding của F): cookie tossing — subdomain anh em đặt `tf_rt` với `Domain=` (Path hẹp hơn
// ⇒ đứng trước). `clear()` host-only chỉ xóa cookie của nạn nhân; nếu cookie kẻ tấn công còn sống,
// lần refresh sau sẽ đăng nhập nạn nhân vào phiên của chúng. Cookie trùng tên ⇒ thu hồi MỌI family.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_REFRESH_COOKIES } from '../../src/modules/auth/presentation/refresh-cookie';
import { errorOf } from '../support/http';
import {
  createTestApp,
  refreshCookieOf,
  setCookieOf,
  WEB,
  type TestApp,
} from '../support/http-app';

let t: TestApp;
beforeEach(() => {
  t = createTestApp();
});

const call = (path: '/refresh' | '/logout', cookie: string, app = t) =>
  request(app.app)
    .post(`/api/v1/auth${path}`)
    .set('Origin', WEB)
    .set('Cookie', cookie)
    .set('Content-Type', 'application/json');

describe('cookie tossing: hai cookie refresh trùng tên', () => {
  it('refresh ⇒ 401 REFRESH_TOKEN_INVALID + xóa cookie; CẢ HAI family bị thu hồi (cookie còn sót không dùng được)', async () => {
    const victim = await t.register('Mia');
    const attacker = await t.register('Eve');

    const res = await call('/refresh', `${attacker.cookie}; ${victim.cookie}`);
    expect(res.status).toBe(401);
    expect(errorOf(res).code).toBe('REFRESH_TOKEN_INVALID');
    expect(setCookieOf(res)).toContain('Max-Age=0');

    // Trình duyệt chỉ xóa được cookie host-only của nạn nhân; cookie Domain= của kẻ tấn công ở lại.
    // Nó PHẢI đã chết — không có hoán đổi phiên.
    expect((await call('/refresh', attacker.cookie)).status).toBe(401);
    expect((await call('/refresh', victim.cookie)).status).toBe(401);
  });

  it('logout ⇒ 204 và thu hồi family của mọi cookie trùng tên', async () => {
    const victim = await t.register('Mia');
    const attacker = await t.register('Eve');

    expect((await call('/logout', `${attacker.cookie}; ${victim.cookie}`)).status).toBe(204);
    expect((await call('/refresh', attacker.cookie)).status).toBe(401);
    expect((await call('/refresh', victim.cookie)).status).toBe(401);
  });

  it('một cookie ⇒ hành vi cũ không đổi (refresh 200)', async () => {
    const mia = await t.register('Mia');
    expect((await call('/refresh', mia.cookie)).status).toBe(200);
  });
});

describe('ADR-109: production chỉ đọc __Host-tf_rt (Domain= bị trình duyệt cấm với tiền tố này)', () => {
  it('nạn nhân KHÔNG có cookie + kẻ tấn công cài cookie khác tên (tf_rt / __Secure-tf_rt) ⇒ 401, không đăng nhập vào tài khoản kẻ tấn công', async () => {
    const prod = createTestApp({ cookieSecure: true });
    const reg = await request(prod.app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send({ email: 'eve@example.com', password: 'correct-horse-12', fullName: 'Eve' });
    const attacker = refreshCookieOf(reg, '__Host-tf_rt'); // `__Host-tf_rt=<token sống>`
    const token = attacker.slice(attacker.indexOf('=') + 1);

    for (const tossed of [`tf_rt=${token}`, `__Secure-tf_rt=${token}`]) {
      const res = await call('/refresh', tossed, prod);
      expect(res.status, tossed.split('=')[0]).toBe(401);
      expect(errorOf(res).code).toBe('REFRESH_TOKEN_INVALID');
    }
    // Đối chứng: đúng tên ⇒ token đó vẫn dùng được (không phải vì token chết).
    expect((await call('/refresh', attacker, prod)).status).toBe(200);
  });
});

describe('quá MAX_REFRESH_COOKIES giá trị trùng tên', () => {
  it('⇒ 401 ngay, không Set-Cookie, không thu hồi từng giá trị (chặn khuếch đại)', async () => {
    const victim = await t.register('Mia');
    const extra = Array.from({ length: MAX_REFRESH_COOKIES }, (_, i) => `tf_rt=junk-${i}`);
    const flood = [victim.cookie, ...extra].join('; ');

    for (const path of ['/refresh', '/logout'] as const) {
      const res = await call(path, flood);
      expect(res.status, path).toBe(401);
      expect(setCookieOf(res), path).toBeUndefined();
    }
    expect((await call('/refresh', victim.cookie)).status).toBe(200); // không bị thu hồi
  });
});
