import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { Actors } from './harness/actors';
import {
  HR,
  adjust,
  eventIdOf,
  eventsOf,
  leaveOf,
  seedHr,
  setGrants,
  submitLeave,
  thisMonth,
  todayVn,
  withKey,
  workday,
  type HrTenant,
} from './harness/hr';
import { errorEnvelope } from './harness/http-client';
import { openSocket, connected, collect } from './harness/socket';
import { secCase, useApi } from './harness/suite';

// SEC-HR-* (docs/design/test-spec-hr.md §7, T-042). Viết TRƯỚC khi có route: mọi ca khai báo pending
// theo vé backend (harness/pending.ts) ⇒ gỡ mục đó khi vé merge là ca tự chạy. Thứ tự lỗi §0.3.

const api = useApi();
const actors = new Actors(api);
let seeded: Promise<HrTenant> | undefined;
const hr = () => (seeded ??= seedHr(actors));

const NIL_WS = '00000000-0000-7000-8000-000000000000';
const AREA = 'Mốc 3 HR';

describe('Cách ly tenant & thứ tự lỗi', () => {
  secCase(
    'SEC-HR-01',
    'Otto (W2) gọi route chấm công/nghỉ của W1 ⇒ 404 giống ws không tồn tại',
    AREA,
    async () => {
      const t = await hr();
      const routes: [string, (ws: string) => string][] = [
        ['GET', (ws) => HR.meToday(ws)],
        ['GET', (ws) => HR.month(ws, thisMonth())],
        ['GET', (ws) => HR.myLeaveRequests(ws)],
        ['POST', (ws) => HR.checkIn(ws)],
      ];
      for (const [method, path] of routes) {
        const res = await actors.json(
          method,
          path(t.ws),
          t.otto.accessToken,
          method === 'GET' ? undefined : {},
        );
        const missing = await actors.json(
          method,
          path(NIL_WS),
          t.otto.accessToken,
          method === 'GET' ? undefined : {},
        );
        expect(res.status, `${method} ${path(t.ws)}`).toBe(404);
        expect(errorEnvelope(res).error).toEqual(errorEnvelope(missing).error);
      }
    },
  );

  secCase(
    'SEC-HR-02',
    'Mia gọi route hr:manage ⇒ 403, body sai cũng 403 (permit trước validate)',
    AREA,
    async () => {
      const t = await hr();
      const calls: [string, string, unknown?][] = [
        ['GET', HR.month(t.ws, thisMonth())],
        ['GET', HR.exportCsv(t.ws, thisMonth())],
        ['GET', HR.today(t.ws)],
        ['POST', HR.events(t.ws), { bogus: true }],
        [
          'PATCH',
          HR.balance(t.ws, t.max.userId, new Date().getUTCFullYear()),
          { adjustmentDays: 'x' },
        ],
      ];
      for (const [method, path, body] of calls) {
        expect(
          (await actors.json(method, path, t.mia.accessToken, body)).status,
          `${method} ${path}`,
        ).toBe(403);
      }
    },
  );

  secCase(
    'SEC-HR-03',
    'Route "me" không nhận userId: Mia gửi ?userId=Max vẫn chỉ thấy dữ liệu của mình (Q6)',
    AREA,
    async () => {
      const t = await hr();
      await withKey(api, 'POST', HR.checkIn(t.ws), t.max.accessToken);
      const res = await actors.json(
        'GET',
        `${HR.me(t.ws, thisMonth())}&userId=${t.max.userId}`,
        t.mia.accessToken,
      );
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) expect(res.text).not.toContain(t.max.userId);
    },
  );

  secCase(
    'SEC-HR-04',
    'IDOR: Hana (W1) approve đơn / void lượt chấm của W2 ⇒ 404',
    AREA,
    async () => {
      const t = await hr();
      const leaveW2 = leaveOf(
        await submitLeave(actors, t.otto, t.wsB, {
          type: 'UNPAID',
          startDate: workday(40),
          endDate: workday(40),
        }),
      );
      // Id lượt chấm THẬT của W2: Otto (OWNER W2) thêm ADJUSTMENT ⇒ 201 AttendanceEventDto (f8ddb7b).
      const adj = await adjust(actors, t.otto, t.wsB, t.otto.userId, 'IN');
      expect(adj.status, 'đối chứng: ADJUSTMENT trong W2').toBe(201);
      const inW2Id = eventIdOf(adj);
      expect(
        (
          await actors.json(
            'POST',
            HR.leaveAction(t.ws, leaveW2.id, 'approve'),
            t.hana.accessToken,
            { expectedVersion: leaveW2.version },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await actors.json('POST', HR.voidEvent(t.ws, inW2Id), t.hana.accessToken, {
            reason: 'idor',
          })
        ).status,
      ).toBe(404);
    },
  );

  secCase('SEC-HR-05', 'Max hủy đơn của Mia ⇒ 404 (không lộ id tồn tại)', AREA, async () => {
    const t = await hr();
    const own = leaveOf(
      await submitLeave(actors, t.mia, t.ws, {
        type: 'UNPAID',
        startDate: workday(41),
        endDate: workday(41),
      }),
    );
    expect(
      (
        await actors.json('POST', HR.leaveAction(t.ws, own.id, 'cancel'), t.max.accessToken, {
          expectedVersion: own.version,
        })
      ).status,
    ).toBe(404);
  });

  secCase('SEC-HR-06', 'Vic (VIEWER) chấm công / gửi đơn ⇒ 403', AREA, async () => {
    const t = await hr();
    expect((await withKey(api, 'POST', HR.checkIn(t.ws), t.vic.accessToken)).status).toBe(403);
    expect(
      (
        await submitLeave(actors, t.vic, t.ws, {
          type: 'UNPAID',
          startDate: workday(42),
          endDate: workday(42),
        })
      ).status,
    ).toBe(403);
  });

  secCase('SEC-HR-25', 'PATCH leave-balances với userId của W2 ⇒ 404', AREA, async () => {
    const t = await hr();
    const res = await actors.json(
      'PATCH',
      HR.balance(t.ws, t.otto.userId, new Date().getUTCFullYear()),
      t.hana.accessToken,
      { adjustmentDays: 1, note: 'idor' },
    );
    expect(res.status).toBe(404);
  });
});

describe('Không tự xử lý dữ liệu của mình (B-H1) & grants', () => {
  secCase('SEC-HR-07', 'Hana tự duyệt / tự adjust / tự PATCH số dư ⇒ 403 cả ba', AREA, async () => {
    const t = await hr();
    const own = leaveOf(
      await submitLeave(actors, t.hana, t.ws, {
        type: 'UNPAID',
        startDate: workday(43),
        endDate: workday(43),
      }),
    );
    expect(
      (
        await actors.json('POST', HR.leaveAction(t.ws, own.id, 'approve'), t.hana.accessToken, {
          expectedVersion: own.version,
        })
      ).status,
    ).toBe(403);
    expect(
      (await adjust(actors, t.hana, t.ws, t.hana.userId, 'IN', '08:00', 'tự sửa')).status,
    ).toBe(403);
    expect(
      (
        await actors.json(
          'PATCH',
          HR.balance(t.ws, t.hana.userId, new Date().getUTCFullYear()),
          t.hana.accessToken,
          { adjustmentDays: 5, note: 'tự cộng' },
        )
      ).status,
    ).toBe(403);
  });

  secCase(
    'SEC-HR-08',
    'Pam (PM) và Hana (HR) cấp grant ⇒ 403 (hr:grant chỉ OWNER)',
    AREA,
    async () => {
      const t = await hr();
      expect((await setGrants(actors, t.pam, t.ws, t.max.userId, ['HR_MANAGE'])).status).toBe(403);
      expect((await setGrants(actors, t.hana, t.ws, t.max.userId, ['HR_MANAGE'])).status).toBe(403);
    },
  );

  secCase(
    'SEC-HR-09',
    'Thu grant của Hana ⇒ CÙNG access token mất quyền ngay request kế tiếp',
    AREA,
    async () => {
      const t = await seedHr(actors); // tenant riêng: ca này đổi quyền
      expect((await actors.json('GET', HR.today(t.ws), t.hana.accessToken)).status).toBe(200); // đối chứng
      expect((await setGrants(actors, t.olivia, t.ws, t.hana.userId, [])).status).toBe(200);
      expect((await actors.json('GET', HR.today(t.ws), t.hana.accessToken)).status).toBe(403);
    },
  );

  secCase(
    'SEC-HR-27',
    'Grant cho OWNER (kể cả [] — thu) và cho VIEWER ⇒ 422 GRANT_NOT_ALLOWED (SetMemberGrantsBody, T-037 f3523e3)',
    AREA,
    async () => {
      const t = await hr();
      const cases: [string, string, string[]][] = [
        ['OWNER cấp', t.olivia.userId, ['HR_MANAGE']],
        ['OWNER thu', t.olivia.userId, []],
        ['VIEWER cấp', t.vic.userId, ['HR_MANAGE']],
      ];
      for (const [tag, userId, grants] of cases) {
        const res = await setGrants(actors, t.olivia, t.ws, userId, grants);
        expect(res.status, tag).toBe(422);
        const { code, details } = errorEnvelope(res).error as {
          code: string;
          details?: { rule?: string };
        };
        expect([code, details?.rule], tag).toEqual([
          'BUSINESS_RULE_VIOLATION',
          'GRANT_NOT_ALLOWED',
        ]);
      }
      // Đối chứng: đặt [] cho MEMBER (Max) là hợp lệ ⇒ 200 + MemberDto có grants [].
      const ok = await setGrants(actors, t.olivia, t.ws, t.max.userId, []);
      expect(ok.status).toBe(200);
      expect((ok.json as { data: { grants: string[] } }).data.grants).toEqual([]);
    },
  );
});

describe('CSV xuất bảng công (OWASP, B-L2..L4)', () => {
  secCase(
    'SEC-HR-11',
    'CSV injection: ô chữ bắt đầu bằng = + - @ \\t \\r có tiền tố \', mọi ô bọc ", " nhân đôi',
    AREA,
    async () => {
      const t = await seedHr(actors);
      for (const name of [
        '=HYPERLINK("http://x")',
        '+1+1',
        '-2',
        '@SUM(A1)',
        '\tTAB',
        'Có "nháy"',
      ]) {
        const u = await actors.register('csv');
        await actors.json('PATCH', '/auth/me', u.accessToken, { fullName: name });
        await actors.addMember(t.olivia, t.ws, u, 'MEMBER');
        await withKey(api, 'POST', HR.checkIn(t.ws), u.accessToken);
      }
      const res = await actors.json('GET', HR.exportCsv(t.ws, thisMonth()), t.hana.accessToken);
      expect(res.status).toBe(200);
      for (const raw of ['=HYPERLINK', '+1+1', '-2', '@SUM']) {
        expect(res.text, raw).toContain(`"'${raw}`);
        expect(res.text).not.toMatch(new RegExp(`(^|,)"?${raw.replace(/[+()]/g, '\\$&')}`, 'm'));
      }
      expect(res.text).toContain('"Có ""nháy"""');
    },
  );

  secCase(
    'SEC-HR-12',
    'CSV header: month đã validate, no-store, BOM, không IP/UA, không lý do nghỉ',
    AREA,
    async () => {
      const t = await hr();
      expect(
        (await actors.json('GET', HR.exportCsv(t.ws, '../../etc'), t.hana.accessToken)).status,
      ).toBe(400);
      await submitLeave(actors, t.mia, t.ws, {
        type: 'SICK',
        startDate: workday(44),
        endDate: workday(44),
        reason: 'BÍ-MẬT-SỨC-KHỎE',
      });
      await withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken);
      const res = await actors.json('GET', HR.exportCsv(t.ws, thisMonth()), t.hana.accessToken);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(String(res.headers['content-disposition'])).toMatch(
        new RegExp(`filename="?[^"]*${thisMonth()}[^"/\\\\]*\\.csv`),
      );
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      expect(res.text).not.toContain('BÍ-MẬT-SỨC-KHỎE');
      expect(res.text.toLowerCase()).not.toMatch(/user-agent|useragent|\bip\b/);
    },
  );

  secCase(
    'SEC-HR-13',
    'CSV: mỗi lần xuất có giới hạn theo user + ws ⇒ quá thì 429',
    AREA,
    async () => {
      const t = await hr();
      let last = 200;
      for (let i = 0; i < 40 && last !== 429; i += 1) {
        last = (await actors.json('GET', HR.exportCsv(t.ws, thisMonth()), t.hana.accessToken))
          .status;
      }
      expect(last).toBe(429);
    },
  );
});

describe('Dữ liệu cá nhân / nhạy cảm', () => {
  secCase(
    'SEC-HR-14',
    'IP/UA: Mia thấy của mình (me/events); HR thấy qua attendance/events; Max không thấy của Mia',
    AREA,
    async () => {
      const t = await hr();
      await withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken);
      const mine = eventsOf(
        await actors.json('GET', HR.myEvents(t.ws, todayVn()), t.mia.accessToken),
      );
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((e) => e.userId === t.mia.userId && e.ip !== null)).toBe(true);
      const byHr = eventsOf(
        await actors.json('GET', HR.eventsOf(t.ws, t.mia.userId, todayVn()), t.hana.accessToken),
      );
      expect(byHr.map((e) => e.id)).toEqual(
        expect.arrayContaining(mine.map((e) => e.id)) as unknown,
      );
      const maxView = await actors.json('GET', HR.myEvents(t.ws, todayVn()), t.max.accessToken);
      expect(maxView.text).not.toContain(t.mia.userId);
    },
  );

  secCase(
    'SEC-HR-28',
    'me/events không lộ lượt của người khác: Max gửi ?userId=Mia vẫn chỉ thấy của mình',
    AREA,
    async () => {
      const t = await hr();
      await withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken);
      const res = await actors.json(
        'GET',
        `${HR.myEvents(t.ws, todayVn())}&userId=${t.mia.userId}`,
        t.max.accessToken,
      );
      expect([200, 400]).toContain(res.status);
      if (res.status === 200)
        expect(eventsOf(res).every((e) => e.userId === t.max.userId)).toBe(true);
    },
  );

  secCase(
    'SEC-HR-29',
    'Thành viên thường gọi attendance/events (lượt thô có IP/UA) ⇒ 403; userId chưa từng có dữ liệu ⇒ 404 (HR)',
    AREA,
    async () => {
      const t = await hr();
      expect(
        (await actors.json('GET', HR.eventsOf(t.ws, t.max.userId, todayVn()), t.mia.accessToken))
          .status,
      ).toBe(403);
      expect(
        (await actors.json('GET', HR.eventsOf(t.ws, randomUUID(), todayVn()), t.hana.accessToken))
          .status,
      ).toBe(404);
    },
  );

  secCase(
    'SEC-HR-15',
    'Lý do nghỉ: không trong thông báo, không trong log process',
    AREA,
    async () => {
      const t = await hr();
      const secret = `LÝ-DO-${Date.now()}`;
      await submitLeave(actors, t.mia, t.ws, {
        type: 'SICK',
        startDate: workday(45),
        endDate: workday(45),
        reason: secret,
      });
      const notes = await actors.json('GET', HR.notifications, t.hana.accessToken);
      expect(notes.text).not.toContain(secret);
      expect(api.logs().join('\n')).not.toContain(secret);
      // Max (không phải người gửi, không HR) không đọc được lý do qua danh sách của mình.
      expect(
        (await actors.json('GET', HR.myLeaveRequests(t.ws), t.max.accessToken)).text,
      ).not.toContain(secret);
      // HrAuditLog (LEAVE_SUBMIT): before/after KHÔNG chép `reason` (B-H2).
      expect(
        (await actors.json('GET', HR.auditLogs(t.ws), t.olivia.accessToken)).text,
      ).not.toContain(secret);
    },
  );

  secCase(
    'SEC-HR-16',
    'HrAuditLog chỉ OWNER đọc (hr:grant): Olivia 200 thấy GRANT của Hana; Hana (HR) 403; Mia 403; Otto 404 như ws không tồn tại',
    AREA,
    async () => {
      const t = await seedHr(actors); // seed cấp HR_MANAGE cho Hana ⇒ có đúng 1 mục GRANT
      const own = await actors.json('GET', HR.auditLogs(t.ws), t.olivia.accessToken);
      expect(own.status).toBe(200);
      const rows = (
        own.json as {
          data: {
            action: string;
            targetUserId: string | null;
            after: { grants?: string[] } | null;
          }[];
        }
      ).data;
      expect(rows).toContainEqual(
        expect.objectContaining({
          action: 'GRANT',
          targetUserId: t.hana.userId,
          after: expect.objectContaining({ grants: ['HR_MANAGE'] }) as unknown,
        }),
      );
      expect((await actors.json('GET', HR.auditLogs(t.ws), t.hana.accessToken)).status).toBe(403);
      expect((await actors.json('GET', HR.auditLogs(t.ws), t.mia.accessToken)).status).toBe(403);
      const foreign = await actors.json('GET', HR.auditLogs(t.ws), t.otto.accessToken);
      const missing = await actors.json('GET', HR.auditLogs(NIL_WS), t.otto.accessToken);
      expect(foreign.status).toBe(404);
      expect(errorEnvelope(foreign).error).toEqual(errorEnvelope(missing).error);
      // cursor HỢP LỆ của endpoint khác (định dạng core/http/cursor.ts: { k, v }) ⇒ 400 (kind riêng — B).
      const otherCursor = Buffer.from(
        JSON.stringify({ k: 'members', v: { after: t.mia.userId } }),
      ).toString('base64url');
      expect(
        (
          await actors.json(
            'GET',
            `${HR.auditLogs(t.ws)}?cursor=${otherCursor}`,
            t.olivia.accessToken,
          )
        ).status,
      ).toBe(400);
    },
  );
});

describe('Thông báo (ADR-123, B-M3)', () => {
  secCase('SEC-HR-17', 'Đánh dấu đã đọc thông báo của người khác ⇒ 404', AREA, async () => {
    const t = await hr();
    await submitLeave(actors, t.mia, t.ws, {
      type: 'UNPAID',
      startDate: workday(46),
      endDate: workday(46),
    });
    const list = (await actors.json('GET', HR.notifications, t.hana.accessToken)).json as {
      data: { id: string }[];
    };
    const id = list.data[0]?.id;
    expect(id, 'Hana có thông báo LEAVE_SUBMITTED').toBeDefined();
    expect(
      (await actors.json('POST', HR.notificationRead(id ?? ''), t.mia.accessToken, {})).status,
    ).toBe(404);
  });

  secCase(
    'SEC-HR-18',
    'Bị xóa khỏi ws ⇒ danh sách không còn thông báo của ws đó',
    AREA,
    async () => {
      const t = await seedHr(actors);
      await withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken);
      await adjust(actors, t.hana, t.ws, t.mia.userId, 'OUT', '17:30', 'quên chấm ra');
      expect((await actors.json('GET', HR.notifications, t.mia.accessToken)).text).toContain(t.ws);
      await actors.json(
        'DELETE',
        `/workspaces/${t.ws}/members/${t.mia.userId}`,
        t.olivia.accessToken,
      );
      expect((await actors.json('GET', HR.notifications, t.mia.accessToken)).text).not.toContain(
        t.ws,
      );
    },
  );

  secCase(
    'SEC-HR-19',
    'Thông báo "dành cho HR" biến mất khi bị thu grant (lọc theo quyền hiện tại)',
    AREA,
    async () => {
      const t = await seedHr(actors);
      await submitLeave(actors, t.mia, t.ws, {
        type: 'UNPAID',
        startDate: workday(47),
        endDate: workday(47),
      });
      expect((await actors.json('GET', HR.notifications, t.hana.accessToken)).text).toContain(
        'LEAVE_SUBMITTED',
      );
      await setGrants(actors, t.olivia, t.ws, t.hana.userId, []);
      expect((await actors.json('GET', HR.notifications, t.hana.accessToken)).text).not.toContain(
        'LEAVE_SUBMITTED',
      );
    },
  );

  secCase(
    'SEC-HR-20',
    'notification:new chỉ tới user:{id}, payload chỉ id + loại (không lý do)',
    AREA,
    async () => {
      const t = await hr();
      const hanaSock = openSocket(api, t.hana.accessToken);
      const maxSock = openSocket(api, t.max.accessToken);
      await Promise.all([connected(hanaSock), connected(maxSock)]);
      const hanaGot = collect<Record<string, unknown>>(hanaSock, 'notification:new');
      const maxGot = collect<Record<string, unknown>>(maxSock, 'notification:new');
      const secret = `RT-${Date.now()}`;
      await submitLeave(actors, t.mia, t.ws, {
        type: 'SICK',
        startDate: workday(48),
        endDate: workday(48),
        reason: secret,
      });
      await expect.poll(() => hanaGot.length, { timeout: 5_000 }).toBeGreaterThan(0);
      expect(JSON.stringify(hanaGot)).not.toContain(secret);
      expect(maxGot).toHaveLength(0);
      hanaSock.close();
      maxSock.close();
    },
  );
});

describe('Biên HTTP', () => {
  secCase(
    'SEC-HR-21',
    'CORS preflight cho phép Idempotency-Key từ origin hợp lệ',
    AREA,
    async () => {
      const t = await hr();
      const res = await api.request({
        method: 'OPTIONS',
        path: `/api/v1${HR.checkIn(t.ws)}`,
        headers: {
          origin: api.webOrigin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'idempotency-key,authorization,content-type',
        },
      });
      expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain(
        'idempotency-key',
      );
    },
  );

  secCase(
    'SEC-HR-22',
    'Client gửi occurredAt/source/workDate khi check-in ⇒ 400 strict (giờ luôn là giờ server)',
    AREA,
    async () => {
      const t = await hr();
      const res = await withKey(api, 'POST', HR.checkIn(t.ws), t.max.accessToken, undefined, {
        occurredAt: '2000-01-01T00:00:00Z',
        source: 'DEVICE',
        workDate: '2000-01-01',
      });
      expect(res.status).toBe(400);
      // HR cũng không gửi được thời điểm UTC: ADJUSTMENT nhận date + time theo lịch, `occurredAt` ⇒ 400 (aac6aaa).
      const adj = await actors.json('POST', HR.events(t.ws), t.hana.accessToken, {
        userId: t.max.userId,
        kind: 'IN',
        date: todayVn(),
        time: '08:00',
        reason: 'strict',
        occurredAt: '2000-01-01T00:00:00Z',
      });
      expect(adj.status).toBe(400);
    },
  );

  secCase(
    'SEC-HR-23',
    'X-Forwarded-For giả khi TRUST_PROXY_HOPS=0 ⇒ IP lưu là IP socket (cần process API riêng hops=0)',
    AREA,
  );

  secCase('SEC-HR-24', 'User-Agent 10 KB ⇒ cắt ≤ 256, không 500', AREA, async () => {
    const t = await hr();
    const res = await api.request({
      method: 'POST',
      path: `/api/v1${HR.checkIn(t.ws)}`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${t.pam.accessToken}`,
        origin: api.webOrigin,
        'idempotency-key': randomUUID(),
        'user-agent': 'U'.repeat(10_000),
      },
      body: '',
    });
    expect(res.status).toBe(201);
  });

  secCase(
    'SEC-HR-26',
    'Idempotency-Key giống hệt của user khác ⇒ người thứ hai nhận 201 (lượt của chính họ), không phải 200 replay',
    AREA,
    async () => {
      const t = await hr();
      const key = randomUUID();
      const a = await withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken, key);
      const b = await withKey(api, 'POST', HR.checkIn(t.ws), t.olivia.accessToken, key);
      expect([a.status, b.status]).toEqual([201, 201]);
      const firstIn = (r: typeof a) =>
        (r.json as { data: { firstIn: string | null } }).data.firstIn;
      expect(firstIn(b)).not.toBeNull();
    },
  );
});
