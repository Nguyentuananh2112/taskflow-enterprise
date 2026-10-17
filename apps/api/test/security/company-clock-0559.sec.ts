import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { refreshCookieOf } from './harness/actors';
import { addDays, nextVnAnchor, vnDateOf } from './harness/clock';
import { useCompanyApi, type CompanyActor } from './harness/company';
import { HR, hrClockEnv } from './harness/hr';
import { expectBefore, today, vnClock } from './harness/hr-clock';
import { errorEnvelope } from './harness/http-client';
import {
  collect,
  connectError,
  connected,
  disconnected,
  emitAck,
  nextEvent,
  openSocket,
} from './harness/socket';
import { secCase } from './harness/suite';

// CLK-HR-05 + SEC-HR-69 + SEC-HR-62 (vế sau 06:00) + SEC-HR-70 (test-spec-company §3, §5; B HIGH-2a/2b): biên `access_until` = 06:00 ngày sau `lastDay`, áp
// NGAY theo giờ nghiệp vụ, không chờ job hoàn tất nghỉ việc.
//
// Mốc thứ Ba 05:59:10 VN. Job `complete-offboardings` chạy lần đầu sau 5–10 s kể từ lúc API khởi động, rồi mỗi
// 60–65 s (maintenance-setup.ts) ⇒ lượt đầu sau 06:00 rơi vào 06:00:15–06:00:35, khe 06:00:00–06:00:15 là "trước
// job". Ca không tin phép tính: tự khẳng định người đó vẫn OFFBOARDING (chưa bị hoàn tất) SAU các lần kiểm.
// Hai ca chạy nối tiếp trong cùng khe (CLK-HR-05 trước, SEC-HR-69 ngay sau) — giữ thứ tự trong file.
const ANCHOR = nextVnAnchor(2, '05:59:10');
const TUE = vnDateOf(ANCHOR);
const MON = addDays(TUE, -1);
const { api, actors } = useCompanyApi(hrClockEnv(ANCHOR));
const AREA = 'Mốc 3.5 — biên access_until 06:00';

let hana: CompanyActor; // nhân viên + HR_MANAGE — đồng hồ của ca (không nghỉ)
let owen: CompanyActor; // OWNER W1
let mia: CompanyActor; // CLK-HR-05
let max: CompanyActor; // SEC-HR-69
let maxCookie: string; // refresh cookie CÒN HẠN của Max (đã xoay một lần trước 06:00)
let w1: string;
let projectId: string;
let task: { id: string; version: number };
let miaSocket: Socket; // đã join phòng project W1
let miaSpare: Socket; // nối trước biên, chưa join
let owenSocket: Socket; // đối chứng

const sockets: Socket[] = [];
const open = (token: string) => {
  const s = openSocket(api, token);
  sockets.push(s);
  return s;
};
afterAll(() => {
  for (const s of sockets.splice(0)) s.close();
});

/**
 * Trạng thái hiển thị của một nhân viên qua `GET hr/employees?q=` (Hana). Danh sách mặc định KHÔNG gồm người đã
 * nghỉ ⇒ hỏi LEFT phải lọc `status=left`.
 */
async function statusOf(who: CompanyActor, status?: 'left'): Promise<string | undefined> {
  const res = await actors.json(
    'GET',
    `/hr/employees?q=${encodeURIComponent(who.email)}${status ? `&status=${status}` : ''}`,
    hana.accessToken,
  );
  expect(res.status, res.text.slice(0, 200)).toBe(200);
  const rows = (res.json as { data: { userId: string; status: string }[] }).data;
  return rows.find((r) => r.userId === who.userId)?.status;
}

/** Poll 200 ms tới khi giờ server ≥ `hms` (HH:mm:ss VN) — nhanh hơn `waitToday` để còn khe trước job. */
async function waitServer(hms: string, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const t = await today(actors, hana);
    if (vnClock(t.serverNow) >= hms) return t.serverNow;
    if (Date.now() > deadline) throw new Error(`hết giờ chờ ${hms} — server ${t.serverNow}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const STILL_PENDING =
  'job đã hoàn tất nghỉ việc trước khi kiểm xong — khe trước job không đủ, xem mốc';

beforeAll(async () => {
  [hana, owen, mia, max] = await Promise.all([
    actors.createUser('clk05-hana', { grants: ['HR_MANAGE'], startDate: MON }),
    actors.createUser('clk05-owen', { startDate: MON }),
    actors.createUser('clk05-mia', { startDate: MON }),
    actors.createUser('clk05-max', { startDate: MON }),
  ]);
  w1 = (await actors.newWorkspace(owen, 'CLK05 W1')).id;
  await actors.addToWorkspace(owen, w1, mia.userId, 'MEMBER');
  // lastDay = hôm qua ⇒ access_until = 06:00 hôm nay, CHƯA tới ⇒ chỉ lên lịch, không hoàn tất trong request.
  for (const who of [mia, max]) {
    expect(await actors.offboard(hana, who.userId, MON)).toMatchObject({
      employee: { status: 'OFFBOARDING', offboardLastDay: MON },
    });
  }
  // SEC-HR-62 / 70: socket của Mia nối TRƯỚC biên — một cái đã vào phòng project W1 (+ phòng user tự động), một cái
  // để thử join sau biên; Owen vào cùng phòng làm đối chứng event.
  projectId = (await actors.createProject(owen, w1, 'CLKX')).id;
  task = await actors.createTask(owen, w1, projectId, 'task W1');
  [miaSocket, miaSpare, owenSocket] = [
    open(mia.accessToken),
    open(mia.accessToken),
    open(owen.accessToken),
  ];
  await Promise.all([connected(miaSocket), connected(miaSpare), connected(owenSocket)]);
  for (const s of [miaSocket, owenSocket]) {
    expect(await emitAck(s, 'project:join', { workspaceId: w1, projectId })).toEqual({ ok: true });
  }
  // Đối chứng SEC-HR-69: trước biên refresh của Max còn chạy (token còn hạn thật) ⇒ giữ cookie mới.
  const ok = await actors.refresh(max.refreshCookie);
  expect(ok.status, ok.text.slice(0, 200)).toBe(200);
  maxCookie = refreshCookieOf(ok);
  await expectBefore(actors, hana, '06:00:00');
}, 120_000);

describe('access_until 06:00 áp ngay, không chờ job', () => {
  secCase(
    'CLK-HR-05',
    'lastDay = hôm qua: trước 06:00 route công ty 200; ngay sau 06:00 (job chưa chạy) ⇒ 401 SESSION_REVOKED, route W1 404',
    AREA,
    async () => {
      await expectBefore(actors, hana, '06:00:00');
      const before = await actors.json('GET', HR.meToday, mia.accessToken);
      expect(before.status, before.text.slice(0, 200)).toBe(200);
      expect((await actors.json('GET', `/workspaces/${w1}`, mia.accessToken)).status).toBe(200);

      await waitServer('06:00:00');
      const company = await actors.json('GET', HR.meToday, mia.accessToken);
      expect(company.status).toBe(401);
      expect(errorEnvelope(company).error.code).toBe('SESSION_REVOKED');
      const ws = await actors.json('GET', `/workspaces/${w1}`, mia.accessToken);
      expect(ws.status).toBe(404);
      expect(errorEnvelope(ws).error).toMatchObject({ details: { resource: 'workspace' } });
      expect(await statusOf(mia), STILL_PENDING).toBe('OFFBOARDING');
    },
    180_000,
  );

  secCase(
    'SEC-HR-69',
    'refresh token còn hạn, sau access_until, trước job ⇒ 401, không cấp access token, không xoay (lần sau vẫn 401)',
    AREA,
    async () => {
      await waitServer('06:00:00');
      const first = await actors.refresh(maxCookie);
      expect(first.status, first.text.slice(0, 200)).toBe(401);
      expect(JSON.stringify(first.json ?? {})).not.toContain('accessToken');
      // Không xoay: không có cookie refresh MỚI (giá trị khác rỗng); cookie xóa (`tf_rt=;`) thì được.
      expect(first.headers['set-cookie'] ?? []).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^(__Secure-|__Host-)?tf_rt=[^;]+/)]),
      );
      const again = await actors.refresh(maxCookie);
      expect(again.status).toBe(401);
      expect(await statusOf(max), STILL_PENDING).toBe('OFFBOARDING');
    },
  );

  secCase(
    'SEC-HR-62b',
    'vế sau 06:00, trước job: handshake mới bị từ chối SESSION_REVOKED; socket đã nối từ trước join project W1 ⇒ RESOURCE_NOT_FOUND',
    AREA,
    async () => {
      await waitServer('06:00:00');
      expect(await connectError(open(mia.accessToken))).toEqual({
        message: 'SESSION_REVOKED',
        code: 'SESSION_REVOKED',
      });
      expect(await emitAck(miaSpare, 'project:join', { workspaceId: w1, projectId })).toEqual({
        ok: false,
        code: 'RESOURCE_NOT_FOUND',
      });
      expect(await statusOf(mia), STILL_PENDING).toBe('OFFBOARDING');
    },
  );

  secCase(
    'SEC-HR-70',
    'socket đã join W1 + user:{id} trước access_until ⇒ bị ngắt ≤ ~70 s sau 06:00 (job); event sau đó không tới; nối lại bị từ chối',
    AREA,
    async () => {
      const crossed = Date.now();
      await waitServer('06:00:00');
      const miaSaw = collect(miaSocket, 'task:updated');
      await disconnected(miaSocket, 75_000);
      expect(Date.now() - crossed, 'ngắt trễ hơn ~70 s sau 06:00').toBeLessThanOrEqual(72_000);
      expect(await statusOf(mia, 'left')).toBe('LEFT');

      const owenGot = nextEvent(owenSocket, 'task:updated');
      const patched = await actors.json(
        'PATCH',
        `/workspaces/${w1}/projects/${projectId}/tasks/${task.id}`,
        owen.accessToken,
        { expectedVersion: task.version, title: 'sau khi Mia nghỉ' },
      );
      expect(patched.status, patched.text.slice(0, 200)).toBe(200);
      await owenGot; // đối chứng: event có phát vào phòng
      expect(miaSaw()).toEqual([]);
      // Hoàn tất đã thu hồi phiên (ADR-105) ⇒ token cũ bị từ chối ở handshake (mã chung, không lộ lý do).
      const again = await connectError(open(mia.accessToken));
      expect(['SESSION_REVOKED', 'UNAUTHORIZED']).toContain(again.code);
    },
    120_000,
  );
});
