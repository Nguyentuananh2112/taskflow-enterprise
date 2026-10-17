import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect } from 'vitest';

import { SEC_CLOCK_ANCHOR, addDays, vnDateOf } from './harness/clock';
import { useCompanyApi, type CompanyActor } from './harness/company';
import { HR, hrClockEnv } from './harness/hr';
import { errorEnvelope } from './harness/http-client';
import { connectError, connected, disconnected, emitAck, openSocket } from './harness/socket';
import { secCase } from './harness/suite';

// SEC-HR-62 (vế hoàn tất trong request) + SEC-HR-68 (test-spec-company §3; ADR-137 "Hoàn tất", ADR-105). Mốc mặc định
// thứ Ba 10:00: `lastDay` = hôm qua ⇒ `access_until` (06:00 hôm nay) đã qua ⇒ PUT offboarding hoàn tất NGAY trong
// request (LEFT) và thu hồi phiên theo mẫu ADR-105 (token_version + refresh token + Valkey, `disconnectUser` sau
// commit). Vế "sau 06:00, trước job" (SESSION_REVOKED) ở company-clock-0559.sec.ts (SEC-HR-62b).
// Người có lastDay = hôm qua phải có startDate ≤ lastDay (422 LAST_DAY_OUT_OF_RANGE) ⇒ tạo với startDate lùi 3 ngày.
const TODAY = vnDateOf(SEC_CLOCK_ANCHOR);
const YESTERDAY = addDays(TODAY, -1);
const START = addDays(TODAY, -3);
const { api, actors } = useCompanyApi(hrClockEnv());
const AREA = 'Mốc 3.5 — nghỉ việc / nhận lại';

const sockets: Socket[] = [];
const open = (token: string) => {
  const s = openSocket(api, token);
  sockets.push(s);
  return s;
};
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});

/** Người đã nghỉ đăng nhập ⇒ như email không tồn tại: cùng status + mã lỗi. */
async function loginLooksUnknown(who: Pick<CompanyActor, 'email' | 'password'>) {
  const known = await actors.json('POST', '/auth/login', undefined, {
    email: who.email,
    password: who.password,
  });
  const ghost = await actors.json('POST', '/auth/login', undefined, {
    email: `ghost-${Date.now()}@sec.example`,
    password: who.password,
  });
  expect(known.status).toBe(401);
  expect(ghost.status).toBe(401);
  // Cùng mã VÀ cùng body lỗi (như SEC-HR-58) — không lộ "tài khoản có nhưng đã nghỉ".
  expect(errorEnvelope(known).error).toEqual(errorEnvelope(ghost).error);
}

describe('Hoàn tất nghỉ việc trong request ⇒ thu hồi mọi cửa', () => {
  secCase(
    'SEC-HR-62',
    'lastDay = hôm qua (đã qua 06:00) ⇒ LEFT ngay; token cũ 401 UNAUTHORIZED (route công ty, route W1), refresh 401 REFRESH_TOKEN_INVALID, handshake từ chối, socket đang nối bị ngắt',
    AREA,
    async () => {
      const [hana, owen, mia] = await Promise.all([
        actors.createUser('off62-hana', { grants: ['HR_MANAGE'], startDate: START }),
        actors.createUser('off62-owen', { startDate: START }),
        actors.createUser('off62-mia', { startDate: START }),
      ]);
      const w1 = (await actors.newWorkspace(owen, 'OFF62 W1')).id;
      await actors.addToWorkspace(owen, w1, mia.userId, 'MEMBER');
      const projectId = (await actors.createProject(owen, w1, 'OFF62')).id;
      const live = open(mia.accessToken);
      await connected(live);
      expect(await emitAck(live, 'project:join', { workspaceId: w1, projectId })).toEqual({
        ok: true,
      });
      // Đối chứng: trước khi nghỉ, mọi cửa đều mở.
      expect((await actors.json('GET', HR.meToday, mia.accessToken)).status).toBe(200);
      expect((await actors.json('GET', `/workspaces/${w1}`, mia.accessToken)).status).toBe(200);

      const dropped = disconnected(live, 10_000);
      const done = await actors.offboard(hana, mia.userId, YESTERDAY);
      expect(done.employee).toMatchObject({ userId: mia.userId, status: 'LEFT' });
      await dropped;

      for (const path of [HR.meToday, `/workspaces/${w1}`]) {
        const res = await actors.json('GET', path, mia.accessToken);
        expect(res.status, `${path}: ${res.text.slice(0, 200)}`).toBe(401);
        expect(errorEnvelope(res).error.code).toBe('UNAUTHORIZED');
      }
      const refreshed = await actors.refresh(mia.refreshCookie);
      expect(refreshed.status).toBe(401);
      expect(errorEnvelope(refreshed).error.code).toBe('REFRESH_TOKEN_INVALID');
      expect((await connectError(open(mia.accessToken))).code).toBe('UNAUTHORIZED');
      await loginLooksUnknown(mia);
    },
  );

  secCase(
    'SEC-HR-68',
    'nhận lại Quinn: trước khi nhận lại như không tồn tại; sau khi nhận lại đăng nhập bằng mật khẩu cũ, token / refresh cũ không sống lại',
    AREA,
    async () => {
      const [hana, quinn] = await Promise.all([
        actors.createUser('off68-hana', { grants: ['HR_MANAGE'], startDate: START }),
        actors.createUser('off68-quinn', { startDate: START }),
      ]);
      expect((await actors.offboard(hana, quinn.userId, YESTERDAY)).employee.status).toBe('LEFT');
      await loginLooksUnknown(quinn);

      const rehired = await actors.hire(hana, { email: quinn.email, fullName: 'Sec Quinn' });
      expect(rehired.status, rehired.text.slice(0, 300)).toBe(201);
      expect((rehired.json as { data: unknown }).data).toMatchObject({
        employee: { userId: quinn.userId, status: 'ACTIVE', startDate: TODAY },
        accountCreated: false,
        activation: null,
      });

      // Phiên trước khi nghỉ đã bị thu hồi lúc hoàn tất ⇒ nhận lại KHÔNG làm chúng sống lại.
      const oldAccess = await actors.json('GET', HR.meToday, quinn.accessToken);
      expect(oldAccess.status).toBe(401);
      expect(errorEnvelope(oldAccess).error.code).toBe('UNAUTHORIZED');
      const oldRefresh = await actors.refresh(quinn.refreshCookie);
      expect(oldRefresh.status).toBe(401);
      expect(errorEnvelope(oldRefresh).error.code).toBe('REFRESH_TOKEN_INVALID');

      // Mật khẩu cũ dùng được (không cần link kích hoạt mới); phiên mới vào được route công ty.
      const back = await actors.login(quinn);
      expect(back.userId).toBe(quinn.userId);
      expect((await actors.json('GET', HR.meToday, back.accessToken)).status).toBe(200);
    },
  );
});
