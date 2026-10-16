import { decodeJwt } from 'jose';
import { describe, expect } from 'vitest';

import { Actors, refreshCookieOf, type Actor } from './harness/actors';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase, useApi } from './harness/suite';

// Cookie tossing / login CSRF (T-028 X1, ADR-109). Subdomain anh em đặt được cookie `Domain=<cha>` với
// tên `tf_rt` / `__Secure-tf_rt` nhưng KHÔNG đặt được `__Host-` (trình duyệt cấm Domain + bắt Path=/).
// Không cần subdomain thật: header Cookie dựng tay đúng như trình duyệt gửi khi jar có cả hai cookie.
// Chạy ở chế độ cookie Secure (như staging/prod) ⇒ tên phải là `__Host-tf_rt`.

const ADR109 = 'ADR-109 __Host- refresh cookie (T-028)';
const HOST = '__Host-tf_rt';
const api = useApi({ COOKIE_SECURE: 'true' });
const actors = new Actors(api);

/** Giá trị token (không kèm tên) của cookie refresh mà API đặt khi đăng ký. */
const tokenOf = (actor: Actor) => actor.refreshCookie.slice(actor.refreshCookie.indexOf('=') + 1);
const refreshWith = (cookieHeader: string) => actors.refresh(cookieHeader);
/** Refresh trả `{ accessToken, expiresIn }` (security.md §2.1) ⇒ chủ phiên = `sub` của access token. */
const userIdOf = (res: RawResponse) =>
  decodeJwt((res.json as { data: { accessToken: string } }).data.accessToken).sub;

function expectInvalid(res: RawResponse, ctx: string) {
  expect(res.status, `${ctx}: ${res.text.slice(0, 200)}`).toBe(401);
  expect(errorEnvelope(res).error.code, ctx).toBe('REFRESH_TOKEN_INVALID');
}

describe('Cookie tossing / login CSRF', () => {
  secCase(
    'SEC-34',
    'Cookie refresh ở staging/prod: __Host-tf_rt; HttpOnly; Secure; SameSite=Strict; Path=/; không Domain (ADR-109)',
    ADR109,
    async () => {
      const victim = await actors.register('host-attrs');
      expect(victim.refreshCookie.startsWith(`${HOST}=`), victim.refreshCookie).toBe(true);
      const res = await refreshWith(victim.refreshCookie);
      expect(res.status).toBe(200);
      const raw = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${HOST}=`));
      expect(raw, JSON.stringify(res.headers['set-cookie'])).toBeDefined();
      const attrs = raw!.split(';').map((a) => a.trim().toLowerCase());
      expect(attrs).toEqual(
        expect.arrayContaining(['httponly', 'secure', 'samesite=strict', 'path=/']),
      );
      expect(attrs.some((a) => a.startsWith('domain='))).toBe(false);
      refreshCookieOf(res);
    },
  );

  secCase(
    'SEC-34b',
    'Cookie tossing: jar có __Host-tf_rt của nạn nhân + tf_rt/__Secure-tf_rt (Domain=) của kẻ tấn công ⇒ 200 vào phiên NẠN NHÂN, cookie lạ bị bỏ qua',
    ADR109,
    async () => {
      const attacker = await actors.register('toss-attacker');
      for (const name of ['__Secure-tf_rt', 'tf_rt']) {
        const victim = await actors.register(`toss-victim-${name}`);
        // Path hẹp hơn đứng trước trong header (RFC 6265 §5.4) — thứ tự kẻ tấn công chọn được.
        const res = await refreshWith(`${name}=${tokenOf(attacker)}; ${HOST}=${tokenOf(victim)}`);
        expect(res.status, `${name}: ${res.text.slice(0, 200)}`).toBe(200);
        expect(userIdOf(res), `${name}: phải là phiên của nạn nhân`).toBe(victim.userId);
      }
      // Cookie bị ném vào không bị đụng tới: token của kẻ tấn công vẫn là của chính nó (không thu hồi chéo).
      const own = await refreshWith(`${HOST}=${tokenOf(attacker)}`);
      expect(own.status).toBe(200);
      expect(userIdOf(own)).toBe(attacker.userId);
    },
  );

  secCase(
    'SEC-34c',
    'Login CSRF: nạn nhân KHÔNG có cookie, chỉ có tf_rt/__Secure-tf_rt hợp lệ do kẻ tấn công ném ⇒ 401, không vào phiên kẻ tấn công',
    ADR109,
    async () => {
      const attacker = await actors.register('csrf-attacker');
      for (const name of ['__Secure-tf_rt', 'tf_rt', '__host-tf_rt', ' __Host-tf_rt_x']) {
        const res = await refreshWith(`${name.trim()}=${tokenOf(attacker)}`);
        expectInvalid(res, `chỉ có cookie ${name.trim()}`);
      }
    },
  );

  secCase(
    'SEC-34d',
    '__Host-tf_rt trùng tên 2–4 giá trị ⇒ 401 + thu hồi tất cả; > 4 giá trị ⇒ 401, không thu hồi; 30 giá trị rác ⇒ 401 nhanh, không 500',
    ADR109,
    async () => {
      const a = await actors.register('dup-a');
      const b = await actors.register('dup-b');
      expectInvalid(await refreshWith(`${HOST}=${tokenOf(a)}; ${HOST}=${tokenOf(b)}`), 'trùng tên');
      expectInvalid(await refreshWith(`${HOST}=${tokenOf(a)}`), 'a sau khi trùng');
      expectInvalid(await refreshWith(`${HOST}=${tokenOf(b)}`), 'b sau khi trùng');

      // > 4 giá trị ⇒ 401 ngay, KHÔNG thu hồi gì (chặn khuếch đại ghi DB/Valkey — B, T-028).
      const c = await actors.register('dup-cap');
      const five = [
        `${HOST}=${tokenOf(c)}`,
        ...['j1', 'j2', 'j3', 'j4'].map((j) => `${HOST}=${j}`),
      ];
      expectInvalid(await refreshWith(five.join('; ')), '5 giá trị');
      expect(
        (await refreshWith(`${HOST}=${tokenOf(c)}`)).status,
        'c không bị thu hồi khi > 4',
      ).toBe(200);

      const junk = Array.from({ length: 30 }, (_, i) => `${HOST}=junk-${String(i)}`).join('; ');
      const started = Date.now();
      expectInvalid(await refreshWith(junk), '30 giá trị rác');
      expect(
        Date.now() - started,
        'không tốn thời gian tuyến tính theo số giá trị kẻ tấn công gửi',
      ).toBeLessThan(5_000);
    },
  );

  secCase(
    'SEC-34e',
    'Logout với cookie lạ đi kèm ⇒ 204 và phiên nạn nhân THẬT SỰ bị thu hồi phía server',
    ADR109,
    async () => {
      const victim = await actors.register('logout-victim');
      const attacker = await actors.register('logout-attacker');
      // Tiền đề: cookie __Host- của nạn nhân dùng được — nếu không, 401 ở cuối là xanh giả.
      const warm = await refreshWith(`${HOST}=${tokenOf(victim)}`);
      expect(warm.status, `tiền đề: ${warm.text.slice(0, 200)}`).toBe(200);
      const victimToken = refreshCookieOf(warm).slice(HOST.length + 1);
      const res = await api.request({
        method: 'POST',
        path: '/api/v1/auth/logout',
        headers: {
          'content-type': 'application/json',
          origin: api.webOrigin,
          cookie: `__Secure-tf_rt=${tokenOf(attacker)}; ${HOST}=${victimToken}`,
        },
        body: '',
      });
      expect(res.status).toBe(204);
      expectInvalid(await refreshWith(`${HOST}=${victimToken}`), 'refresh nạn nhân sau logout');
    },
  );
});
