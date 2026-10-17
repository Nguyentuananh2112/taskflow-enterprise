import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect } from 'vitest';

import { addDays } from './harness/clock';
import { useCompanyApi, type CompanyActor } from './harness/company';
import {
  eventsOf,
  HR,
  hrClockEnv,
  leaveOf,
  setGrants,
  submitLeave,
  todayVn,
  withKey,
  workday,
} from './harness/hr';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { connected, openSocket } from './harness/socket';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// Mốc 3.5 — IDOR giữa người, chọn thành viên ws theo người thuộc công ty, route cũ đã gỡ (docs/design/test-spec-company.md
// §3): SEC-HR-36, 37, 39. Một công ty / DB / file (§0.4): không đếm tuyệt đối, tìm theo id.

const { api, actors } = useCompanyApi(hrClockEnv());
const AREA = 'Mốc 3.5 cấp công ty (T-061/T-062/T-063)';
const TODAY = todayVn();

let mia: CompanyActor; // nhân viên, OWNER W1
let max: CompanyActor; // nhân viên, MEMBER W1
let hana: CompanyActor; // nhân viên + HR_MANAGE
let w1: string;

beforeAll(async () => {
  mia = await actors.createUser('mia');
  max = await actors.createUser('max');
  hana = await actors.createUser('hana', { grants: ['HR_MANAGE'] });
  w1 = (await actors.newWorkspace(mia, 'Sec W1')).id;
  await actors.addToWorkspace(mia, w1, max.userId, 'MEMBER');
}, 120_000);

const call = (who: CompanyActor | undefined, method: string, path: string, body?: unknown) =>
  actors.json(method, path, who?.accessToken, body);

const expectStatus = (res: RawResponse, status: number, what: string) =>
  expect(res.status, `${what}: ${res.text.slice(0, 300)}`).toBe(status);
const detailsOf = (res: RawResponse) => errorEnvelope(res).error.details;

describe('IDOR giữa người (route self / HR)', () => {
  // Đặc tả ghi "Max đọc me/events với id lượt của Mia": `GET attendance/me/events` chỉ nhận `date` (strict) và luôn
  // lọc theo người gọi ⇒ kiểm (a) cùng ngày Max không thấy lượt của Mia, (b) thêm `userId` ⇒ 400, không đọc hộ.
  secCase(
    'SEC-HR-36',
    'Max hủy đơn / đọc lượt chấm / đánh dấu đã đọc thông báo của Mia ⇒ 404 (không lộ tồn tại); HR đọc lượt của người chưa từng là nhân viên ⇒ 404',
    AREA,
    async () => {
      // Lượt chấm của Mia hôm nay (mốc nghiệp vụ T3 10:00).
      const punched = await withKey(api, 'POST', HR.checkIn, mia.accessToken);
      expectStatus(punched, 201, 'Mia check-in');
      const miaEvents = eventsOf(await call(mia, 'GET', HR.myEvents(TODAY)));
      expect(miaEvents).toHaveLength(1);
      const miaEventId = miaEvents[0]!.id;
      const maxView = await call(max, 'GET', HR.myEvents(TODAY));
      expectStatus(maxView, 200, 'Max đọc me/events');
      expect(maxView.text).not.toContain(miaEventId);
      expectStatus(
        await call(max, 'GET', `${HR.myEvents(TODAY)}&userId=${mia.userId}`),
        400,
        'Max me/events kèm userId',
      );

      // Đơn của Mia: Max hủy ⇒ 404 leave_request, giống hệt đơn không tồn tại.
      const sent = await submitLeave(actors, mia, {
        type: 'UNPAID',
        startDate: workday(16),
        endDate: workday(16),
      });
      expectStatus(sent, 201, 'Mia xin nghỉ');
      const leave = leaveOf(sent);
      const foreign = await call(max, 'POST', HR.leaveAction(leave.id, 'cancel'), {
        expectedVersion: leave.version,
      });
      const missing = await call(max, 'POST', HR.leaveAction(randomUUID(), 'cancel'), {
        expectedVersion: leave.version,
      });
      expectStatus(foreign, 404, 'Max hủy đơn của Mia');
      expectStatus(missing, 404, 'Max hủy đơn không tồn tại');
      expect(detailsOf(foreign)).toEqual(detailsOf(missing));

      // Thông báo của Mia (HR duyệt đơn ⇒ Mia có thông báo mới): Max đánh dấu đã đọc ⇒ 404, Mia vẫn chưa đọc.
      const before = await actors.notificationIds(mia);
      expectStatus(
        await call(hana, 'POST', HR.leaveAction(leave.id, 'approve'), {
          expectedVersion: leave.version,
        }),
        200,
        'Hana duyệt đơn Mia',
      );
      const fresh = [...(await actors.notificationIds(mia))].filter((id) => !before.has(id));
      expect(fresh.length).toBeGreaterThan(0);
      const notificationId = fresh[0]!;
      const readForeign = await call(max, 'POST', HR.notificationRead(notificationId));
      const readMissing = await call(max, 'POST', HR.notificationRead(randomUUID()));
      expectStatus(readForeign, 404, 'Max đọc thông báo của Mia');
      expectStatus(readMissing, 404, 'Max đọc thông báo không tồn tại');
      expect(detailsOf(readForeign)).toEqual(detailsOf(readMissing));
      const miaList = await call(mia, 'GET', `${HR.notifications}?limit=50`);
      expect(
        (miaList.json as { data: { id: string; readAt: string | null }[] }).data.find(
          (n) => n.id === notificationId,
        ),
      ).toMatchObject({ readAt: null });

      // HR đọc lượt chấm: Ada (Admin, chưa từng là nhân viên) / id lạ ⇒ 404 user.
      for (const userId of [actors.ada.userId, randomUUID()]) {
        const res = await call(hana, 'GET', HR.eventsOf(userId, TODAY));
        expectStatus(res, 404, `Hana GET events userId=${userId}`);
        expect(detailsOf(res)).toEqual({ resource: 'user' });
      }
    },
  );
});

describe('Thành viên ws = người thuộc công ty (ADR-134)', () => {
  secCase(
    'SEC-HR-37',
    'Thêm vào W1: id lạ ⇒ 404; đã nghỉ / sắp nghỉ ⇒ 422; chờ kích hoạt / Admin ⇒ 201; MEMBER gọi member-candidates ⇒ 403; q có % _ \\ khớp chữ thường; q 1 000 ký tự ⇒ 400; lần 61/giờ ⇒ 429',
    AREA,
    async () => {
      const quinn = await actors.createUser('quinn', { startDate: addDays(TODAY, -5) });
      const left = await actors.offboard(actors.ada, quinn.userId, addDays(TODAY, -1));
      expect(left.employee.status).toBe('LEFT');
      const leaving = await actors.createUser('leaving');
      await actors.offboard(actors.ada, leaving.userId, addDays(TODAY, 30));
      const nina = await actors.createUser('nina', { pending: true });
      const quokka = await actors.createUser('quokka');

      const add = (userId: string) =>
        call(mia, 'POST', `/workspaces/${w1}/members`, { userId, role: 'MEMBER' });
      // Đặc tả ghi 422 `NOT_ACTIVE_EMPLOYEE` cho "userId không thuộc công ty": qua API không tạo được user ngoài công
      // ty (ADR-140) ⇒ id lạ = không có user ⇒ 404 `user` (AddMemberUseCase); người đã rời công ty là Quinn.
      const unknown = await add(randomUUID());
      expectStatus(unknown, 404, 'thêm id lạ');
      expect(detailsOf(unknown)).toEqual({ resource: 'user' });
      for (const [who, what] of [
        [quinn, 'Quinn (đã nghỉ)'],
        [leaving, 'người sắp nghỉ'],
      ] as const) {
        const res = await add(who.userId);
        expectStatus(res, 422, `thêm ${what}`);
        expect(detailsOf(res)).toMatchObject({ rule: 'NOT_ACTIVE_MEMBER' });
      }
      expectStatus(await add(nina.userId), 201, 'thêm Nina (chờ kích hoạt)');
      expectStatus(await add(actors.ada.userId), 201, 'thêm Ada (Admin)');

      const candidates = (who: CompanyActor, q: string) =>
        call(who, 'GET', `/workspaces/${w1}/member-candidates?q=${encodeURIComponent(q)}`);
      expectStatus(await candidates(max, 'quokka'), 403, 'MEMBER gọi member-candidates');

      // Hạn mức 60/giờ/actor (R41): đếm từ 0 sau khi tạo người (createUser xóa bộ đếm).
      await flushRateLimitCounters();
      let used = 0;
      const search = async (q: string) => {
        used++;
        const res = await candidates(mia, q);
        expectStatus(res, 200, `q=${JSON.stringify(q)}`);
        return (res.json as { data: { id: string }[] }).data.map((c) => c.id);
      };
      expect(await search('Sec quokka')).toEqual([quokka.userId]); // đối chứng: tìm thật
      for (const q of ['%%', '__', '\\\\', 'quo_ka', 'quo%a', 'Sec %']) {
        expect(await search(q), `q=${q} phải khớp chữ thường`).toEqual([]);
      }
      used++;
      expectStatus(await candidates(mia, 'x'.repeat(1000)), 400, 'q 1 000 ký tự');
      while (used < 60) await search('Sec quokka');
      const over = await candidates(mia, 'Sec quokka');
      expectStatus(over, 429, 'lần 61/giờ');
    },
  );
});

describe('Route cũ đã gỡ (ADR-140)', () => {
  secCase(
    'SEC-HR-39',
    'POST auth/register và route ws cũ (attendance / leave-requests / grants / hr-audit-logs, /me/attendance) ⇒ 404 chung, không lộ email; cấp grant ⇒ chỉ company:access-changed, không member:grants-changed',
    AREA,
    async () => {
      const email = `old-${randomUUID()}@sec.example`;
      const notFound: RawResponse[] = [];
      for (const body of [
        { email, password: 'correct-horse-battery-staple-9', fullName: 'Cũ', workspaceName: 'Cũ' },
        { email: max.email, password: 'x' },
        {},
      ]) {
        const res = await call(undefined, 'POST', '/auth/register', body);
        expectStatus(res, 404, 'POST auth/register');
        expect(res.text).not.toContain(email);
        expect(res.text).not.toContain(max.email);
        notFound.push(res);
      }
      const old: [string, string, unknown][] = [
        ['GET', `/workspaces/${w1}/attendance/me/today`, undefined],
        ['POST', `/workspaces/${w1}/attendance/check-in`, {}],
        ['GET', `/workspaces/${w1}/leave-requests`, undefined],
        ['PUT', `/workspaces/${w1}/members/${max.userId}/grants`, { grants: ['HR_MANAGE'] }],
        ['GET', `/workspaces/${w1}/hr-audit-logs`, undefined],
        ['GET', '/me/attendance/today', undefined],
      ];
      for (const [method, path, body] of old) {
        const res = await call(mia, method, path, body);
        expectStatus(res, 404, `${method} ${path}`);
        notFound.push(res);
      }
      // 404 chung của router: cùng mã + details cho mọi route đã gỡ (không phải 404 tài nguyên).
      const shapes = new Set(
        notFound.map((r) => JSON.stringify([errorEnvelope(r).error.code, detailsOf(r)])),
      );
      expect([...shapes]).toHaveLength(1);

      // Cấp grant cho người mới ⇒ realtime CHỈ `company:access-changed` tới user:{id}.
      const vic = await actors.createUser('vic-39');
      const sock = openSocket(api, vic.accessToken);
      try {
        await connected(sock);
        const access: { data?: { role?: string; grants?: string[] } }[] = [];
        const legacy: unknown[] = [];
        sock.on('company:access-changed', (p: (typeof access)[number]) => access.push(p));
        sock.on('member:grants-changed', (p: unknown) => legacy.push(p));
        const res = await setGrants(actors, vic.userId, ['HR_MANAGE']);
        expectStatus(res, 200, 'Ada cấp HR_MANAGE');
        await expect.poll(() => access.length, { timeout: 5_000 }).toBeGreaterThan(0);
        expect(access[0]?.data).toEqual({ role: 'EMPLOYEE', grants: ['HR_MANAGE'] });
        await new Promise((r) => setTimeout(r, 300));
        expect(legacy).toEqual([]);
      } finally {
        sock.close();
      }
    },
  );
});
