import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { refreshCookieOf } from './harness/actors';
import { useCompanyApi } from './harness/company';
import { addDays } from './harness/clock';
import { HR, hrClockEnv, todayVn } from './harness/hr';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// SEC-HR-56…61, 63 (test-spec-company §3, T-066 — F): kích hoạt tài khoản bằng link (ADR-137) — token một lần, hạn
// 7 ngày (hết hạn: CLK-HR-06, file đồng hồ của B), thu hồi khi "tạo lại link", không lộ tồn tại, hạn mức IP chung
// inspect + activate (chỉ đếm 400/410), token không rò ra audit / thông báo / log / danh sách. Phía web (fragment xóa,
// Referrer-Policy, request không mang token): E2E-HR-17.

const { api, actors } = useCompanyApi(hrClockEnv());
const AREA = 'Mốc 3.5 kích hoạt';
const STRONG = 'kich-hoat-mat-khau-du-dai-9';

/** Request công khai tới auth/activation — `ip` cố định khi cần chạm hạn mức IP (mặc định: IP ngẫu nhiên). */
function publicPost(path: string, body: unknown, ip?: string): Promise<RawResponse> {
  if (!ip) return actors.json('POST', path, undefined, body);
  return api.request({
    method: 'POST',
    path: `/api/v1${path}`,
    headers: { 'content-type': 'application/json', origin: api.webOrigin, 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}
const inspect = (token: string, ip?: string) =>
  publicPost('/auth/activation/inspect', { token }, ip);
const activate = (token: string, password = STRONG, ip?: string) =>
  publicPost('/auth/activate', { token, password }, ip);
/** Envelope lỗi bỏ `meta` (requestId / timestamp khác nhau mỗi request). */
const errorOf = (res: RawResponse) => errorEnvelope(res).error;
/** Đổi đúng một ký tự (giữ độ dài, vẫn base64url). */
const tamper = (token: string) => `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

describe('Token một lần, không lộ tồn tại', () => {
  secCase(
    'SEC-HR-56',
    'Token dùng lần 2 / bị thu hồi do tạo lại link ⇒ 410 ACTIVATION_GONE; sửa 1 ký tự / rác 3 độ dài ⇒ 400 ACTIVATION_INVALID, body giống hệt nhau (inspect và activate)',
    AREA,
    async () => {
      const hana = await actors.createUser('act56-hana', { grants: ['HR_MANAGE'] });
      // Đã dùng.
      const used = await actors.createUser('act56-used', { pending: true });
      expect((await activate(used.token)).status).toBe(200);
      // Bị thu hồi: tạo lại link ⇒ token cũ chết NGAY, token mới sống.
      const revoked = await actors.createUser('act56-rev', { pending: true });
      const fresh = await actors.reissueActivation(hana, revoked.userId);
      for (const [label, token] of [
        ['đã dùng', used.token],
        ['bị thu hồi', revoked.token],
      ] as const) {
        for (const [route, res] of [
          ['inspect', await inspect(token)],
          ['activate', await activate(token)],
        ] as const) {
          expect(res.status, `${label} ${route}: ${res.text.slice(0, 160)}`).toBe(410);
          expect(errorOf(res).code, `${label} ${route}`).toBe('ACTIVATION_GONE');
        }
      }
      // Sai / rác: CÙNG một 400 (không phân biệt "gần đúng" với "rác" — không dò được).
      const live = await actors.createUser('act56-live', { pending: true });
      const invalid = [tamper(live.token), 'x', 'z'.repeat(43), 'q'.repeat(256)];
      const bodies: string[] = [];
      for (const token of invalid) {
        for (const res of [await inspect(token), await activate(token)]) {
          expect(res.status, `${token.slice(0, 12)}…: ${res.text.slice(0, 160)}`).toBe(400);
          expect(errorOf(res).code).toBe('ACTIVATION_INVALID');
          bodies.push(JSON.stringify(errorOf(res)));
        }
      }
      expect(
        new Set(bodies).size,
        `400 phải giống hệt nhau: ${[...new Set(bodies)].join(' | ')}`,
      ).toBe(1);
      // Đối chứng: token mới (sau tạo lại) và token sống vẫn dùng được.
      expect((await activate(fresh.token)).status).toBe(200);
      expect((await activate(live.token)).status).toBe(200);
    },
  );

  secCase(
    'SEC-HR-57',
    'Hạn mức IP chung inspect + activate: 10 lần token sai / 15 phút / IP ⇒ lần 11 ⇒ 429 (chỉ đếm 400/410)',
    AREA,
    async () => {
      await flushRateLimitCounters();
      const ip = `10.57.${String(1 + Math.floor(Math.random() * 250))}.9`;
      // Lượt THÀNH CÔNG không đếm (countOnlyStatuses 400/410): inspect token sống ×3 trước.
      const live = await actors.createUser('act57-live', { pending: true });
      for (let i = 0; i < 3; i += 1) expect((await inspect(live.token, ip)).status).toBe(200);
      for (let i = 0; i < 10; i += 1) {
        const res =
          i % 2 === 0
            ? await inspect(`sai-${String(i)}`, ip)
            : await activate(`sai-${String(i)}`, STRONG, ip);
        expect(res.status, `#${String(i + 1)}`).toBe(400);
      }
      const eleventh = await inspect('sai-11', ip);
      expect(eleventh.status, eleventh.text.slice(0, 160)).toBe(429);
      // Cùng IP, token sống cũng bị chặn (hạn mức theo IP, trước validate); IP khác không bị ảnh hưởng.
      expect((await activate(live.token, STRONG, ip)).status).toBe(429);
      expect((await inspect(live.token)).status).toBe(200);
    },
  );
});

describe('Tài khoản chưa kích hoạt / đã nghỉ', () => {
  secCase(
    'SEC-HR-58',
    'Nina (chờ kích hoạt) login như user không tồn tại; Quinn (đã nghỉ) login như không tồn tại, refresh cũ 401, access token cũ 401',
    AREA,
    async () => {
      const nina = await actors.createUser('act58-nina', { pending: true });
      const nobody = `nobody-${randomUUID()}@sec.example`;
      const login = (email: string, password: string) =>
        actors.json('POST', '/auth/login', undefined, { email, password });
      const ghost = await login(nobody, 'mat-khau-bat-ky-12');
      expect(ghost.status).toBe(401);
      for (const password of ['mat-khau-bat-ky-12', STRONG]) {
        const res = await login(nina.email, password);
        expect(res.status, `Nina ${password}`).toBe(401);
        expect(errorOf(res), `Nina ${password}: như user không tồn tại`).toEqual(errorOf(ghost));
      }
      // Mật khẩu rỗng: chặn ở schema (400) cho MỌI email — không nói gì về tồn tại.
      expect(errorOf(await login(nina.email, ''))).toEqual(errorOf(await login(nobody, '')));

      // Quinn: nhiệm kỳ từ 3 ngày trước (lastDay ≥ startDate — B T-062), nghỉ với ngày cuối = hôm qua ⇒ hoàn tất ngay.
      const hana = await actors.createUser('act58-hana', { grants: ['HR_MANAGE'] });
      const quinn = await actors.createUser('act58-quinn', { startDate: addDays(todayVn(), -3) });
      const off = await actors.offboardRaw(hana, quinn.userId, addDays(todayVn(), -1));
      expect(off.status, off.text.slice(0, 200)).toBe(200);
      const quinnLogin = await login(quinn.email, quinn.password);
      expect(quinnLogin.status).toBe(401);
      expect(errorOf(quinnLogin), 'Quinn đã nghỉ: như user không tồn tại').toEqual(
        errorOf(await login(nobody, quinn.password)),
      );
      expect((await actors.refresh(quinn.refreshCookie)).status).toBe(401);
      // Hoàn tất ⇒ token_version + 1 ⇒ authenticate từ chối trước cổng công ty (UNAUTHORIZED — B T-062; khe
      // SESSION_REVOKED "quá access_until, job chưa chạy" ở company-clock-0559 của D).
      const old = await actors.json('GET', HR.meToday, quinn.accessToken);
      expect(old.status).toBe(401);
      expect(errorOf(old).code).toBe('UNAUTHORIZED');
    },
  );
});

describe('Token không rò', () => {
  secCase(
    'SEC-HR-59',
    'Token không có trong audit, thông báo, log process, hr/employees; response thêm / tạo lại link có no-store',
    AREA,
    async () => {
      const hana = await actors.createUser('act59-hana', { grants: ['HR_MANAGE'] });
      const email = `act59-${randomUUID()}@sec.example`;
      const hired = await actors.hire(hana, { email, fullName: 'Sec Act59' });
      expect(hired.status).toBe(201);
      expect(String(hired.headers['cache-control'])).toContain('no-store');
      const first = (
        hired.json as { data: { employee: { userId: string }; activation: { token: string } } }
      ).data;
      const reissued = await actors.json(
        'POST',
        `/hr/employees/${first.employee.userId}/activation-link`,
        hana.accessToken,
        {},
      );
      expect(reissued.status).toBe(200);
      expect(String(reissued.headers['cache-control'])).toContain('no-store');
      const second = (reissued.json as { data: { activation: { token: string } } }).data.activation
        .token;

      for (const token of [first.activation.token, second]) {
        const where: [string, string][] = [
          ['audit', (await actors.json('GET', HR.auditLogs, actors.ada.accessToken)).text],
          ['thông báo Hana', (await actors.json('GET', HR.notifications, hana.accessToken)).text],
          [
            'thông báo Ada',
            (await actors.json('GET', HR.notifications, actors.ada.accessToken)).text,
          ],
          [
            'hr/employees',
            (
              await actors.json(
                'GET',
                `/hr/employees?status=pending&q=${encodeURIComponent(email)}`,
                hana.accessToken,
              )
            ).text,
          ],
          ['log process', api.logs().join('\n')],
        ];
        for (const [label, text] of where) expect(text, `${label} chứa token`).not.toContain(token);
      }
      // Danh sách có người này (đối chứng: tìm đúng chỗ) nhưng không có token / link.
      const list = await actors.json(
        'GET',
        `/hr/employees?status=pending&q=${encodeURIComponent(email)}`,
        hana.accessToken,
      );
      expect(list.text).toContain(email);
      expect(list.text).not.toMatch(/activate#t=/);
    },
  );

  secCase(
    'SEC-HR-60',
    'Bot xem trước: inspect 5 lần không tiêu token ⇒ activate vẫn 200, lần sau 410',
    AREA,
    async () => {
      const nina = await actors.createUser('act60-nina', { pending: true });
      for (let i = 0; i < 5; i += 1) {
        const res = await inspect(nina.token);
        expect(res.status, `inspect #${String(i + 1)}`).toBe(200);
        expect((res.json as { data: { email: string } }).data.email).toBe(nina.email);
      }
      const ok = await activate(nina.token);
      expect(ok.status).toBe(200);
      expect(refreshCookieOf(ok)).toMatch(/tf_rt=/);
      expect((await inspect(nina.token)).status).toBe(410);
    },
  );

  secCase(
    'SEC-HR-61',
    'activate mật khẩu yếu ⇒ 400 VALIDATION_ERROR, token vẫn sống; mật khẩu tốt ⇒ 200 + phiên; dùng lại ⇒ 410',
    AREA,
    async () => {
      const nina = await actors.createUser('act61-nina', { pending: true });
      // B (T-062): policy kiểm TRƯỚC transaction ⇒ 400 VALIDATION_ERROR path password (spec ghi 422 — đã chốt 400).
      const weak = await activate(nina.token, 'password1234');
      expect(weak.status).toBe(400);
      expect(errorOf(weak).code).toBe('VALIDATION_ERROR');
      expect((await inspect(nina.token)).status, 'token vẫn sống').toBe(200);
      const ok = await activate(nina.token);
      expect(ok.status).toBe(200);
      const token = (ok.json as { data: { accessToken: string } }).data.accessToken;
      expect((await actors.json('GET', '/auth/me', token)).status).toBe(200);
      expect((await activate(nina.token)).status).toBe(410);
    },
  );
});

describe('Hạn mức HR', () => {
  secCase(
    'SEC-HR-63',
    'Hana thêm nhân viên lần 31 / giờ ⇒ 429 + Retry-After',
    AREA,
    async () => {
      const hana = await actors.createUser('act63-hana', { grants: ['HR_MANAGE'] });
      await flushRateLimitCounters();
      const hire = (i: number) =>
        actors.hire(hana, {
          email: `act63-${String(i)}-${randomUUID()}@sec.example`,
          fullName: `Sec Act63 ${String(i)}`,
        });
      for (let i = 1; i <= 30; i += 1) expect((await hire(i)).status, `#${String(i)}`).toBe(201);
      const over = await hire(31);
      expect(over.status, over.text.slice(0, 160)).toBe(429);
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    },
    60_000,
  );

  secCase(
    'SEC-HR-63b',
    'Tạo lại link cho MỘT người lần 11 / giờ ⇒ 429 + Retry-After (design company-level §SEC-HR-63)',
    AREA,
    async () => {
      const hana = await actors.createUser('act63b-hana', { grants: ['HR_MANAGE'] });
      const nina = await actors.createUser('act63b-nina', { pending: true });
      await flushRateLimitCounters();
      const reissue = () =>
        actors.json('POST', `/hr/employees/${nina.userId}/activation-link`, hana.accessToken, {});
      for (let i = 1; i <= 10; i += 1) expect((await reissue()).status, `#${String(i)}`).toBe(200);
      const over = await reissue();
      expect(over.status, `lần 11: ${over.text.slice(0, 160)}`).toBe(429);
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    },
  );
});
