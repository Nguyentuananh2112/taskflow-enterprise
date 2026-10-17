import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { useCompanyApi } from './harness/company';
import { addDays } from './harness/clock';
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
  hrClockEnv,
} from './harness/hr';
import { errorEnvelope } from './harness/http-client';
import { openSocket, connected } from './harness/socket';
import { secCase } from './harness/suite';

// SEC-HR-* (test-spec-hr §7, T-042) chuyển sang Mốc 3.5 "cấp công ty" (test-spec-company §6.1, T-066): một công ty
// ⇒ không còn cách ly W1/W2 cho chấm công / nghỉ phép; quyền HR là grant công ty `HR_MANAGE`; Admin (Ada) không
// phải nhân viên. Thứ tự lỗi §0.3: 401 (không thuộc công ty) → 403 (thiếu quyền) → 400 → 404.

// Giờ nghiệp vụ neo thứ Ba 10:00 VN (harness/clock.ts) — cùng mốc với workday()/todayVn().
const { api, actors } = useCompanyApi(hrClockEnv());
let seeded: Promise<HrTenant> | undefined;
const hr = () => (seeded ??= seedHr(actors));
/** Nhân viên MỚI — ca cần "chưa chấm vào hôm nay" không phụ thuộc thứ tự ca khác đã check-in. */
const newcomer = (label: string) => actors.createUser(`hr-${label}`);

const AREA = 'Mốc 3.5 HR';
const YEAR = () => Number(todayVn().slice(0, 4));

describe('Quyền & thứ tự lỗi', () => {
  secCase(
    'SEC-HR-01',
    'Otto (nhân viên, không grant) gọi route hr:manage ⇒ 403 (§6.1 R: một công ty — "W2 ⇒ 404" hết nghĩa)',
    AREA,
    async () => {
      const t = await hr();
      const routes: [string, string][] = [
        ['GET', HR.today],
        ['GET', HR.month(thisMonth())],
        ['GET', HR.eventsOf(t.mia.userId, todayVn())],
        ['GET', HR.exportCsv(thisMonth())],
        ['GET', `${HR.leaveRequests}?status=PENDING`],
      ];
      for (const [method, path] of routes) {
        const res = await actors.json(method, path, t.otto.accessToken);
        expect(res.status, `${method} ${path}`).toBe(403);
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
        ['GET', HR.month(thisMonth())],
        ['GET', HR.exportCsv(thisMonth())],
        ['GET', HR.today],
        ['POST', HR.events, { bogus: true }],
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
    'SEC-HR-02b',
    'Mia gọi PATCH leave/balances (hr:manage) với body sai ⇒ 403, không 400',
    AREA,
    async () => {
      const t = await hr();
      const path = HR.balance(t.max.userId, YEAR());
      const res = await actors.json('PATCH', path, t.mia.accessToken, { adjustmentDays: 'x' });
      expect(res.status, `PATCH ${path}`).toBe(403);
    },
  );

  secCase(
    'SEC-HR-03',
    'Route "me" không nhận userId: Mia gửi ?userId=Max vẫn chỉ thấy dữ liệu của mình (Q6)',
    AREA,
    async () => {
      const t = await hr();
      await withKey(api, 'POST', HR.checkIn, t.max.accessToken);
      const res = await actors.json(
        'GET',
        `${HR.me(thisMonth())}&userId=${t.max.userId}`,
        t.mia.accessToken,
      );
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) expect(res.text).not.toContain(t.max.userId);
    },
  );

  secCase(
    'SEC-HR-04',
    'IDOR giữa người (§6.1 R): Max (không grant) duyệt đơn / hủy lượt chấm của Mia ⇒ 403; Hana với id không tồn tại ⇒ 404',
    AREA,
    async () => {
      const t = await hr();
      const leave = leaveOf(
        await submitLeave(actors, t.mia, {
          type: 'UNPAID',
          startDate: workday(40),
          endDate: workday(40),
        }),
      );
      const adj = await adjust(actors, t.hana, t.mia.userId, 'IN');
      expect(adj.status, `đối chứng: ADJUSTMENT cho Mia: ${adj.text.slice(0, 200)}`).toBe(201);
      const eventId = eventIdOf(adj);
      const approve = (by: typeof t.max, id: string, version: number) =>
        actors.json('POST', HR.leaveAction(id, 'approve'), by.accessToken, {
          expectedVersion: version,
        });
      const voidIt = (by: typeof t.max, id: string) =>
        actors.json('POST', HR.voidEvent(id), by.accessToken, { reason: 'idor' });
      expect((await approve(t.max, leave.id, leave.version)).status).toBe(403);
      expect((await voidIt(t.max, eventId)).status).toBe(403);
      expect((await approve(t.hana, randomUUID(), 1)).status).toBe(404);
      expect((await voidIt(t.hana, randomUUID())).status).toBe(404);
    },
  );

  secCase('SEC-HR-05', 'Max hủy đơn của Mia ⇒ 404 (không lộ id tồn tại)', AREA, async () => {
    const t = await hr();
    const own = leaveOf(
      await submitLeave(actors, t.mia, {
        type: 'UNPAID',
        startDate: workday(42),
        endDate: workday(42),
      }),
    );
    expect(
      (
        await actors.json('POST', HR.leaveAction(own.id, 'cancel'), t.max.accessToken, {
          expectedVersion: own.version,
        })
      ).status,
    ).toBe(404);
  });

  secCase(
    'SEC-HR-06',
    'ĐẢO (§6.1): Vic (VIEWER dự án) là nhân viên ⇒ chấm công / gửi đơn 201; Ada (Admin, không attendance:self / leave:self) ⇒ 403',
    AREA,
    async () => {
      const t = await hr();
      expect((await withKey(api, 'POST', HR.checkIn, t.vic.accessToken)).status).toBe(201);
      const body = { type: 'UNPAID', startDate: workday(52), endDate: workday(52) };
      expect((await submitLeave(actors, t.vic, body)).status).toBe(201);
      expect((await withKey(api, 'POST', HR.checkIn, t.ada.accessToken)).status).toBe(403);
      expect((await submitLeave(actors, t.ada, body)).status).toBe(403);
    },
  );

  secCase(
    'SEC-HR-25',
    'PATCH leave/balances với userId chưa từng là nhân viên (Ada — Admin; id ngẫu nhiên) ⇒ 404',
    AREA,
    async () => {
      const t = await hr();
      for (const userId of [t.ada.userId, randomUUID()]) {
        const res = await actors.json('PATCH', HR.balance(userId, YEAR()), t.hana.accessToken, {
          adjustmentDays: 1,
          note: 'idor',
        });
        expect(res.status, userId).toBe(404);
      }
    },
  );
});

describe('Không tự xử lý dữ liệu của mình (B-H1) & grants', () => {
  secCase('SEC-HR-07', 'Hana tự duyệt / tự adjust / tự PATCH số dư ⇒ 403 cả ba', AREA, async () => {
    const t = await hr();
    const own = leaveOf(
      await submitLeave(actors, t.hana, {
        type: 'UNPAID',
        startDate: workday(54),
        endDate: workday(54),
      }),
    );
    expect(
      (
        await actors.json('POST', HR.leaveAction(own.id, 'approve'), t.hana.accessToken, {
          expectedVersion: own.version,
        })
      ).status,
    ).toBe(403);
    expect((await adjust(actors, t.hana, t.hana.userId, 'IN', '08:00', 'tự sửa')).status).toBe(403);
    expect(
      (
        await actors.json('PATCH', HR.balance(t.hana.userId, YEAR()), t.hana.accessToken, {
          adjustmentDays: 5,
          note: 'tự cộng',
        })
      ).status,
    ).toBe(403);
  });

  secCase(
    'SEC-HR-08',
    'Mia và Hana (HR) cấp grant qua admin/access ⇒ 403 (company:grant chỉ Admin — §6.1 ⇒ SEC-HR-30/31)',
    AREA,
    async () => {
      const t = await hr();
      expect((await setGrants(actors, t.max.userId, ['HR_MANAGE'], t.mia)).status).toBe(403);
      expect((await setGrants(actors, t.max.userId, ['HR_MANAGE'], t.hana)).status).toBe(403);
    },
  );

  secCase(
    'SEC-HR-09',
    'Ada thu grant của Hana ⇒ CÙNG access token mất hr:manage ngay request kế tiếp',
    AREA,
    async () => {
      const t = await seedHr(actors); // bối cảnh riêng: ca này đổi quyền
      expect((await actors.json('GET', HR.today, t.hana.accessToken)).status).toBe(200); // đối chứng
      expect((await setGrants(actors, t.hana.userId, [])).status).toBe(200);
      expect((await actors.json('GET', HR.today, t.hana.accessToken)).status).toBe(403);
    },
  );

  secCase(
    'SEC-HR-27',
    'Grant cho ADMIN ⇒ 422 GRANT_NOT_ALLOWED (Admin ngầm có mọi quyền — §6.1 R); đặt [] cho nhân viên ⇒ 200',
    AREA,
    async () => {
      const t = await hr();
      const ada2 = await actors.createUser('hr-ada2', { admin: true });
      const version = async (userId: string) =>
        (
          (await actors.json('GET', HR.access, t.ada.accessToken)).json as {
            data: { userId: string; version: number }[];
          }
        ).data.find((r) => r.userId === userId)?.version ?? 0;
      const res = await actors.json('PUT', HR.accessOf(ada2.userId), t.ada.accessToken, {
        role: 'ADMIN',
        grants: ['HR_MANAGE'],
        expectedVersion: await version(ada2.userId),
      });
      expect(res.status, res.text.slice(0, 200)).toBe(422);
      const { code, details } = errorEnvelope(res).error as {
        code: string;
        details?: { rule?: string };
      };
      expect([code, details?.rule]).toEqual(['BUSINESS_RULE_VIOLATION', 'GRANT_NOT_ALLOWED']);
      // Đối chứng: đặt [] cho nhân viên (Max) là hợp lệ ⇒ 200 + AccessDto có grants [].
      const ok = await setGrants(actors, t.max.userId, []);
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
      const t = await hr();
      for (const name of [
        '=HYPERLINK("http://x")',
        '+1+1',
        '-2',
        '@SUM(A1)',
        '\tTAB',
        'Có "nháy"',
      ]) {
        const u = await actors.createUser('csv');
        await actors.json('PATCH', '/auth/me', u.accessToken, { fullName: name });
        await withKey(api, 'POST', HR.checkIn, u.accessToken);
      }
      const res = await actors.json('GET', HR.exportCsv(thisMonth()), t.hana.accessToken);
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
      expect((await actors.json('GET', HR.exportCsv('../../etc'), t.hana.accessToken)).status).toBe(
        400,
      );
      await submitLeave(actors, t.mia, {
        type: 'SICK',
        startDate: workday(44),
        endDate: workday(44),
        reason: 'BÍ-MẬT-SỨC-KHỎE',
      });
      await withKey(api, 'POST', HR.checkIn, t.mia.accessToken);
      const res = await actors.json('GET', HR.exportCsv(thisMonth()), t.hana.accessToken);
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

  secCase('SEC-HR-13', 'CSV: giới hạn theo user ⇒ quá thì 429', AREA, async () => {
    const t = await hr();
    let last = 200;
    for (let i = 0; i < 40 && last !== 429; i += 1) {
      last = (await actors.json('GET', HR.exportCsv(thisMonth()), t.hana.accessToken)).status;
    }
    expect(last).toBe(429);
  });
});

describe('Dữ liệu cá nhân / nhạy cảm', () => {
  secCase(
    'SEC-HR-14',
    'IP/UA: Ivy thấy của mình (me/events); HR thấy qua attendance/events; Max không thấy của Ivy',
    AREA,
    async () => {
      const t = await hr();
      // Nhân viên MỚI: lượt của Mia (bối cảnh chung) có cả ADJUSTMENT do HR thêm (SEC-HR-04) — lượt đó không có IP.
      const ivy = await newcomer('ivy');
      await withKey(api, 'POST', HR.checkIn, ivy.accessToken);
      const mine = eventsOf(await actors.json('GET', HR.myEvents(todayVn()), ivy.accessToken));
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((e) => e.userId === ivy.userId && e.ip !== null)).toBe(true);
      const byHr = eventsOf(
        await actors.json('GET', HR.eventsOf(ivy.userId, todayVn()), t.hana.accessToken),
      );
      expect(byHr.map((e) => e.id)).toEqual(
        expect.arrayContaining(mine.map((e) => e.id)) as unknown,
      );
      const maxView = await actors.json('GET', HR.myEvents(todayVn()), t.max.accessToken);
      expect(maxView.text).not.toContain(ivy.userId);
    },
  );

  secCase(
    'SEC-HR-28',
    'me/events không lộ lượt của người khác: Max gửi ?userId=Mia vẫn chỉ thấy của mình',
    AREA,
    async () => {
      const t = await hr();
      await withKey(api, 'POST', HR.checkIn, t.mia.accessToken);
      const res = await actors.json(
        'GET',
        `${HR.myEvents(todayVn())}&userId=${t.mia.userId}`,
        t.max.accessToken,
      );
      expect([200, 400]).toContain(res.status);
      if (res.status === 200)
        expect(eventsOf(res).every((e) => e.userId === t.max.userId)).toBe(true);
    },
  );

  secCase(
    'SEC-HR-29',
    'Nhân viên thường gọi attendance/events (lượt thô có IP/UA) ⇒ 403; userId chưa từng có nhiệm kỳ ⇒ 404 (HR)',
    AREA,
    async () => {
      const t = await hr();
      expect(
        (await actors.json('GET', HR.eventsOf(t.max.userId, todayVn()), t.mia.accessToken)).status,
      ).toBe(403);
      for (const userId of [randomUUID(), t.ada.userId]) {
        expect(
          (await actors.json('GET', HR.eventsOf(userId, todayVn()), t.hana.accessToken)).status,
          userId,
        ).toBe(404);
      }
    },
  );

  secCase(
    'SEC-HR-15',
    'Lý do nghỉ: không trong thông báo, không trong log process, không trong danh sách của người khác',
    AREA,
    async () => {
      const t = await hr();
      const secret = `LÝ-DO-${Date.now()}`;
      await submitLeave(actors, t.mia, {
        type: 'SICK',
        startDate: workday(46),
        endDate: workday(46),
        reason: secret,
      });
      const notes = await actors.json('GET', HR.notifications, t.hana.accessToken);
      expect(notes.text).not.toContain(secret);
      expect(api.logs().join('\n')).not.toContain(secret);
      // Max (không phải người gửi, không HR) không đọc được lý do qua danh sách của mình.
      expect((await actors.json('GET', HR.myLeaveRequests, t.max.accessToken)).text).not.toContain(
        secret,
      );
      // HrAuditLog không chép `reason` (B-H2): ở SEC-HR-16 (route hr/audit-logs).
    },
  );

  secCase(
    'SEC-HR-16',
    'HrAuditLog chỉ Admin đọc (ADR-136): Ada 200 thấy GRANT_SET của Hana, không chép lý do nghỉ; Hana (HR) 403; Mia 403; cursor endpoint khác ⇒ 400',
    AREA,
    async () => {
      const t = await seedHr(actors); // seed cấp HR_MANAGE cho Hana ⇒ có mục GRANT của Hana
      const secret = `AUDIT-LÝ-DO-${Date.now()}`;
      await submitLeave(actors, t.mia, {
        type: 'SICK',
        startDate: workday(49),
        endDate: workday(49),
        reason: secret,
      });
      const own = await actors.json('GET', HR.auditLogs, t.ada.accessToken);
      expect(own.status, own.text.slice(0, 200)).toBe(200);
      expect(own.text).not.toContain(secret);
      const rows = (
        own.json as {
          data: { action: string; targetUserId: string | null; after: unknown }[];
        }
      ).data;
      expect(rows).toContainEqual(
        expect.objectContaining({ action: 'GRANT_SET', targetUserId: t.hana.userId }),
      );
      expect((await actors.json('GET', HR.auditLogs, t.hana.accessToken)).status).toBe(403);
      expect((await actors.json('GET', HR.auditLogs, t.mia.accessToken)).status).toBe(403);
      // cursor HỢP LỆ của endpoint khác (định dạng core/http/cursor.ts: { k, v }) ⇒ 400 (kind riêng — B).
      const otherCursor = Buffer.from(
        JSON.stringify({ k: 'members', v: { after: t.mia.userId } }),
      ).toString('base64url');
      expect(
        (await actors.json('GET', `${HR.auditLogs}?cursor=${otherCursor}`, t.ada.accessToken))
          .status,
      ).toBe(400);
    },
  );
});

describe('Thông báo (ADR-123, B-M3)', () => {
  secCase('SEC-HR-17', 'Đánh dấu đã đọc thông báo của người khác ⇒ 404', AREA, async () => {
    const t = await hr();
    const before = new Set(
      (
        (await actors.json('GET', HR.notifications, t.hana.accessToken)).json as {
          data: { id: string }[];
        }
      ).data.map((n) => n.id),
    );
    await submitLeave(actors, t.mia, {
      type: 'UNPAID',
      startDate: workday(48),
      endDate: workday(48),
    });
    const list = (await actors.json('GET', HR.notifications, t.hana.accessToken)).json as {
      data: { id: string }[];
    };
    // Một công ty: HR nhận thông báo của mọi ca ⇒ lấy thông báo MỚI của ca này (§0.4).
    const id = list.data.find((n) => !before.has(n.id))?.id;
    expect(id, 'Hana có thông báo LEAVE_SUBMITTED mới').toBeDefined();
    expect(
      (await actors.json('POST', HR.notificationRead(id ?? ''), t.mia.accessToken, {})).status,
    ).toBe(404);
  });

  secCase(
    'SEC-HR-18',
    '§6.1 R: người đã nghỉ việc (ngày làm cuối đã qua ⇒ hoàn tất ngay) ⇒ me/notifications 401 SESSION_REVOKED',
    AREA,
    async () => {
      const t = await seedHr(actors);
      await adjust(actors, t.hana, t.mia.userId, 'OUT', '17:30', 'quên chấm ra');
      expect((await actors.json('GET', HR.notifications, t.mia.accessToken)).status).toBe(200);
      const off = await actors.offboardRaw(t.hana, t.mia.userId, addDays(todayVn(), -1));
      expect(off.status, off.text.slice(0, 200)).toBe(200);
      const after = await actors.json('GET', HR.notifications, t.mia.accessToken);
      expect(after.status).toBe(401);
      expect(errorEnvelope(after).error.code).toBe('SESSION_REVOKED');
    },
  );

  secCase(
    'SEC-HR-19',
    'Thông báo "dành cho HR" biến mất khi bị thu grant (lọc theo quyền hiện tại)',
    AREA,
    async () => {
      const t = await seedHr(actors);
      await submitLeave(actors, t.mia, {
        type: 'UNPAID',
        startDate: workday(47),
        endDate: workday(47),
      });
      expect((await actors.json('GET', HR.notifications, t.hana.accessToken)).text).toContain(
        'LEAVE_SUBMITTED',
      );
      expect((await setGrants(actors, t.hana.userId, [])).status).toBe(200);
      expect((await actors.json('GET', HR.notifications, t.hana.accessToken)).text).not.toContain(
        'LEAVE_SUBMITTED',
      );
    },
  );

  secCase(
    'SEC-HR-20',
    'notification:new chỉ tới user:{id}, payload chỉ id + loại (không lý do, không workspaceId — §6.1)',
    AREA,
    async () => {
      const t = await hr();
      const hanaSock = openSocket(api, t.hana.accessToken);
      const maxSock = openSocket(api, t.max.accessToken);
      await Promise.all([connected(hanaSock), connected(maxSock)]);
      // Mảng nghe trực tiếp (collect() trả về HÀM dừng-và-lấy — `.length` của nó là 0, gate T-040b).
      const hanaGot: Record<string, unknown>[] = [];
      const maxGot: Record<string, unknown>[] = [];
      hanaSock.on('notification:new', (p: Record<string, unknown>) => hanaGot.push(p));
      maxSock.on('notification:new', (p: Record<string, unknown>) => maxGot.push(p));
      const secret = `RT-${Date.now()}`;
      const sent = await submitLeave(actors, t.mia, {
        type: 'SICK',
        startDate: workday(50),
        endDate: workday(50),
        reason: secret,
      });
      expect(sent.status, sent.text.slice(0, 200)).toBe(201);
      await expect.poll(() => hanaGot.length, { timeout: 5_000 }).toBeGreaterThan(0);
      expect(JSON.stringify(hanaGot)).not.toContain(secret);
      // Vỏ realtime chung (eventId, type, occurredAt, actorId, originClientId, data); `data` CHỈ id + loại.
      const event = hanaGot[0] as { type?: string; data?: Record<string, unknown> };
      expect(event.type).toBe('notification:new');
      expect(Object.keys(event.data ?? {}).sort()).toEqual(['notificationId', 'type']);
      expect(event.data).toMatchObject({ type: 'LEAVE_SUBMITTED' });
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
      const res = await api.request({
        method: 'OPTIONS',
        path: `/api/v1${HR.checkIn}`,
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
      const nora = await newcomer('nora');
      const res = await withKey(api, 'POST', HR.checkIn, nora.accessToken, undefined, {
        occurredAt: '2000-01-01T00:00:00Z',
        source: 'DEVICE',
        workDate: '2000-01-01',
      });
      // Spec: 400 strict HOẶC bị bỏ qua (A, cdd3096: check-in không có schema body ⇒ bỏ qua). Bỏ qua thì
      // lượt ghi phải là WEB, ngày công hôm nay, giờ server — không lấy gì từ body.
      expect([400, 201], `status ${String(res.status)}`).toContain(res.status);
      if (res.status === 201) {
        const own = eventsOf(await actors.json('GET', HR.myEvents(todayVn()), nora.accessToken));
        expect(own).toHaveLength(1);
        expect(own[0]).toMatchObject({ kind: 'IN', source: 'WEB', workDate: todayVn() });
        expect(own.some((e) => e.workDate === '2000-01-01')).toBe(false);
      }
      // HR cũng không gửi được thời điểm UTC: ADJUSTMENT nhận date + time theo lịch, `occurredAt` ⇒ 400 (aac6aaa).
      const adj = await actors.json('POST', HR.events, t.hana.accessToken, {
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

  // SEC-HR-23 ở hr-proxy.sec.ts (process API riêng TRUST_PROXY_HOPS=0).

  secCase('SEC-HR-24', 'User-Agent 10 KB ⇒ cắt ≤ 256, không 500', AREA, async () => {
    const uma = await newcomer('uma');
    const res = await api.request({
      method: 'POST',
      path: `/api/v1${HR.checkIn}`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${uma.accessToken}`,
        origin: api.webOrigin,
        'idempotency-key': randomUUID(),
        'user-agent': 'U'.repeat(10_000),
      },
      body: '{}',
    });
    expect(res.status).toBe(201);
  });

  secCase(
    'SEC-HR-26',
    'Idempotency-Key giống hệt của user khác ⇒ người thứ hai nhận 201 (lượt của chính họ), không phải 200 replay',
    AREA,
    async () => {
      const [ann, ben] = await Promise.all([newcomer('ann'), newcomer('ben')]);
      const key = randomUUID();
      const a = await withKey(api, 'POST', HR.checkIn, ann.accessToken, key);
      const b = await withKey(api, 'POST', HR.checkIn, ben.accessToken, key);
      expect([a.status, b.status]).toEqual([201, 201]);
      const firstIn = (r: typeof a) =>
        (r.json as { data: { firstIn: string | null } }).data.firstIn;
      expect(firstIn(b)).not.toBeNull();
    },
  );
});
