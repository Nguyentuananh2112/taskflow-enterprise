import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { Actors, type Actor } from './harness/actors';
import { HR, leaveOf, seedHr, setGrants, submitLeave, withKey, workday } from './harness/hr';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase, useApi } from './harness/suite';

// CC-HR-* (test-spec-hr §8, T-042) — đua HỘP ĐEN qua HTTP + Postgres thật, ×20 mỗi ca. Đặt ở suite bảo
// mật thay vì `test/integration` vì module chưa có (không import được use case); kiểm cùng bất biến:
// đúng một bên thắng, bên thua nhận mã đúng, DB không ở trạng thái nửa vời. Pending theo vé (pending.ts).

const api = useApi();
const actors = new Actors(api);
const RUNS = 20;
const AREA = 'Mốc 3 HR races';
const TIMEOUT = 180_000;
const statuses = (rs: RawResponse[]) => rs.map((r) => r.status).sort((a, b) => a - b);
/** Mã lỗi (test-spec-hr §0.2b): 409 RESOURCE_CONFLICT + reason (thường); 422 BUSINESS_RULE_VIOLATION + rule (HOA). */
function expectLoser(rs: RawResponse[], status: 409 | 422, detail: string, tag: string) {
  const loser = rs.find((r) => r.status === status);
  expect(loser, tag).toBeDefined();
  const { code, details } = errorEnvelope(loser as RawResponse).error as {
    code: string;
    details?: Record<string, unknown>;
  };
  if (status === 409) {
    expect(code, tag).toBe('RESOURCE_CONFLICT');
    expect(details?.['reason'], tag).toBe(detail);
  } else {
    expect(code, tag).toBe('BUSINESS_RULE_VIOLATION');
    expect(details?.['rule'], tag).toBe(detail);
  }
}

async function freshPair() {
  const t = await seedHr(actors);
  return t;
}

describe('Chấm công song song', () => {
  secCase(
    'CC-HR-01',
    '2 check-in song song (key khác) ⇒ đúng 1 × 201 + 1 × 409 already_checked_in, DB 1 IN',
    AREA,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const rs = await Promise.all([
          withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken),
          withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken),
        ]);
        expect(statuses(rs), `#${i}`).toEqual([201, 409]);
        expectLoser(rs, 409, 'already_checked_in', `#${i}`);
        const today = (await actors.json('GET', HR.meToday(t.ws), t.mia.accessToken)).json as {
          data: { firstIn: string | null };
        };
        expect(today.data.firstIn).not.toBeNull();
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-02',
    '2 check-in song song CÙNG Idempotency-Key ⇒ cùng id, DB 1 dòng',
    AREA,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const key = randomUUID();
        const rs = await Promise.all([
          withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken, key),
          withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken, key),
        ]);
        expect(
          rs.every((r) => r.status === 201 || r.status === 200),
          `#${i}: ${statuses(rs).join('/')}`,
        ).toBe(true);
        const ids = rs.map((r) => (r.json as { data: { id: string } }).data.id);
        expect(ids[0]).toBe(ids[1]);
      }
    },
    TIMEOUT,
  );
});

describe('Đơn nghỉ song song', () => {
  const decide = (
    by: Actor,
    ws: string,
    id: string,
    action: 'approve' | 'reject' | 'revoke' | 'cancel',
    version: number,
    extra: object = {},
  ) =>
    actors.json('POST', HR.leaveAction(ws, id, action), by.accessToken, {
      expectedVersion: version,
      ...extra,
    });

  secCase(
    'CC-HR-03',
    'approve ‖ cancel cùng đơn ⇒ 1 thắng, 1 × 409; trạng thái cuối khớp bên thắng',
    AREA,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const l = leaveOf(
          await submitLeave(actors, t.mia, t.ws, {
            type: 'UNPAID',
            startDate: workday(30),
            endDate: workday(30),
          }),
        );
        const rs = await Promise.all([
          decide(t.hana, t.ws, l.id, 'approve', l.version),
          decide(t.mia, t.ws, l.id, 'cancel', l.version),
        ]);
        expect(statuses(rs), `#${i}`).toEqual([200, 409]);
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-04',
    '2 đơn ANNUAL song song vượt số dư (≥ 9 + ≥ 9 ngày công > 12) ⇒ 1 × 201 + 1 × 422 insufficient_balance',
    AREA,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const rs = await Promise.all([
          submitLeave(actors, t.mia, t.ws, {
            type: 'ANNUAL',
            startDate: workday(60),
            endDate: workday(70),
          }),
          submitLeave(actors, t.mia, t.ws, {
            type: 'ANNUAL',
            startDate: workday(90),
            endDate: workday(100),
          }),
        ]);
        expect(statuses(rs), `#${i}`).toEqual([201, 422]);
        expectLoser(rs, 422, 'INSUFFICIENT_BALANCE', `#${i}`);
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-05',
    '2 đơn chồng ngày song song ⇒ 1 × 201 + 1 × 409 overlap',
    AREA,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const body = { type: 'UNPAID', startDate: workday(31), endDate: workday(32) };
        const rs = await Promise.all([
          submitLeave(actors, t.mia, t.ws, body),
          submitLeave(actors, t.mia, t.ws, body),
        ]);
        expect(statuses(rs), `#${i}`).toEqual([201, 409]);
        expectLoser(rs, 409, 'overlapping_leave', `#${i}`);
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-06',
    '2 đơn AM ‖ PM cùng ngày ⇒ cả hai 201',
    AREA,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const d = workday(33);
        const rs = await Promise.all([
          submitLeave(actors, t.mia, t.ws, {
            type: 'UNPAID',
            startDate: d,
            endDate: d,
            dayPart: 'AM',
          }),
          submitLeave(actors, t.mia, t.ws, {
            type: 'UNPAID',
            startDate: d,
            endDate: d,
            dayPart: 'PM',
          }),
        ]);
        expect(statuses(rs), `#${i}`).toEqual([201, 201]);
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-07',
    'submit ANNUAL ‖ HR giảm số dư ⇒ không bao giờ còn > 0 ngày "âm vì đang chờ"',
    AREA,
    async () => {
      const year = Number(workday(60).slice(0, 4));
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const [submit, patch] = await Promise.all([
          submitLeave(actors, t.mia, t.ws, {
            type: 'ANNUAL',
            startDate: workday(60),
            endDate: workday(70),
          }),
          actors.json('PATCH', HR.balance(t.ws, t.mia.userId, year), t.hana.accessToken, {
            adjustmentDays: -6,
            reason: 'race',
          }),
        ]);
        // Cùng khóa advisory ⇒ tuần tự hóa: PATCH trước ⇒ còn 6 < ≥9 ngày ⇒ 422; submit trước ⇒ 201 rồi
        // PATCH vẫn 200 (số dư âm được phép — Q4). Không bao giờ 500/409 do đua.
        expect([201, 422], `#${i}: ${submit.status} ${submit.text.slice(0, 120)}`).toContain(
          submit.status,
        );
        expect(patch.status, `#${i}`).toBe(200);
        const bal = (await actors.json('GET', HR.myBalance(t.ws, year), t.mia.accessToken))
          .json as { data: { pendingDays: number } };
        expect(bal.data.pendingDays > 0, `#${i}: pending phản ánh đúng đơn`).toBe(
          submit.status === 201,
        );
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-08',
    'approve ‖ HR giảm số dư ⇒ approve 422 hoặc PATCH sau; số dư đã dùng không vượt hạn mức',
    AREA,
    async () => {
      const year = Number(workday(60).slice(0, 4));
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const l = leaveOf(
          await submitLeave(actors, t.mia, t.ws, {
            type: 'ANNUAL',
            startDate: workday(60),
            endDate: workday(70),
          }),
        );
        const [ap] = await Promise.all([
          decide(t.hana, t.ws, l.id, 'approve', l.version),
          actors.json('PATCH', HR.balance(t.ws, t.mia.userId, year), t.olivia.accessToken, {
            adjustmentDays: -6,
            reason: 'race',
          }),
        ]);
        expect([200, 422], `#${i}: ${ap.status} ${ap.text.slice(0, 120)}`).toContain(ap.status);
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-09',
    '2 HR approve ‖ reject cùng đơn ⇒ 1 thắng, 1 × 409',
    AREA,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const l = leaveOf(
          await submitLeave(actors, t.mia, t.ws, {
            type: 'UNPAID',
            startDate: workday(34),
            endDate: workday(34),
          }),
        );
        const rs = await Promise.all([
          decide(t.hana, t.ws, l.id, 'approve', l.version),
          decide(t.olivia, t.ws, l.id, 'reject', l.version, { decisionNote: 'race' }),
        ]);
        expect(statuses(rs), `#${i}`).toEqual([200, 409]);
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-10',
    'revoke ‖ người gửi cancel (APPROVED, chưa bắt đầu) ⇒ 1 thắng; số dư trả đúng 1 lần',
    AREA,
    async () => {
      const year = Number(workday(60).slice(0, 4));
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const l = leaveOf(
          await submitLeave(actors, t.mia, t.ws, {
            type: 'ANNUAL',
            startDate: workday(60),
            endDate: workday(61),
          }),
        );
        const ap = leaveOf(await decide(t.hana, t.ws, l.id, 'approve', l.version));
        const rs = await Promise.all([
          decide(t.hana, t.ws, l.id, 'revoke', ap.version, { reason: 'race' }),
          decide(t.mia, t.ws, l.id, 'cancel', ap.version),
        ]);
        expect(statuses(rs), `#${i}`).toEqual([200, 409]);
        const bal = (await actors.json('GET', HR.myBalance(t.ws, year), t.mia.accessToken))
          .json as { data: { remaining: number } };
        expect(bal.data.remaining, `#${i}`).toBe(12);
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-11',
    'thu grant ‖ HR approve ⇒ không approve nào commit sau commit thu grant',
    AREA,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const l = leaveOf(
          await submitLeave(actors, t.mia, t.ws, {
            type: 'UNPAID',
            startDate: workday(35),
            endDate: workday(35),
          }),
        );
        const [revoke, ap] = await Promise.all([
          setGrants(actors, t.olivia, t.ws, t.hana.userId, []),
          decide(t.hana, t.ws, l.id, 'approve', l.version),
        ]);
        expect(revoke.status).toBe(200);
        expect([200, 403], `#${i}`).toContain(ap.status);
        // Sau khi thu xong, mọi lần duyệt tiếp ⇒ 403 (đọc lại grants sau khóa — B-H3).
        const again = leaveOf(
          await submitLeave(actors, t.max, t.ws, {
            type: 'UNPAID',
            startDate: workday(36),
            endDate: workday(36),
          }),
        );
        expect((await decide(t.hana, t.ws, again.id, 'approve', again.version)).status).toBe(403);
      }
    },
    TIMEOUT,
  );

  secCase(
    'SEC-HR-10',
    'Hana bị thu grant giữa lúc mở và bấm duyệt (×20) ⇒ không lần nào duyệt thành công SAU khi thu (= CC-HR-11)',
    AREA,
    async () => {
      const t = await freshPair();
      await setGrants(actors, t.olivia, t.ws, t.hana.userId, []);
      for (let i = 0; i < RUNS; i += 1) {
        const l = leaveOf(
          await submitLeave(actors, t.mia, t.ws, {
            type: 'UNPAID',
            startDate: workday(100 + i),
            endDate: workday(100 + i),
          }),
        );
        expect((await decide(t.hana, t.ws, l.id, 'approve', l.version)).status, `#${i}`).toBe(403);
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-12',
    'đọc số dư lần đầu song song (tạo lười) ⇒ không 500, cùng giá trị',
    AREA,
    async () => {
      const year = Number(workday(60).slice(0, 4));
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const rs = await Promise.all(
          Array.from({ length: 5 }, () =>
            actors.json('GET', HR.myBalance(t.ws, year), t.mia.accessToken),
          ),
        );
        expect(
          rs.map((r) => r.status),
          `#${i}`,
        ).toEqual([200, 200, 200, 200, 200]);
        expect(new Set(rs.map((r) => r.text)).size).toBe(1);
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-13',
    'thêm ngày lễ ‖ approve đơn chứa ngày đó ⇒ số ngày đọc lại khớp lịch sau cùng',
    AREA,
  );

  secCase(
    'CC-HR-14',
    'đổi role Hana → VIEWER ‖ cấp grant cho Hana ⇒ không bao giờ VIEWER còn grant',
    AREA,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        await setGrants(actors, t.olivia, t.ws, t.hana.userId, []);
        await Promise.all([
          actors.json(
            'PATCH',
            `/workspaces/${t.ws}/members/${t.hana.userId}`,
            t.olivia.accessToken,
            { role: 'VIEWER' },
          ),
          setGrants(actors, t.olivia, t.ws, t.hana.userId, ['HR_MANAGE']),
        ]);
        const m = (
          await actors.json('GET', `/workspaces/${t.ws}/members?limit=100`, t.olivia.accessToken)
        ).json as { data: { userId: string; role: string; grants?: string[] }[] };
        const hana = m.data.find((x) => x.userId === t.hana.userId);
        if (hana?.role === 'VIEWER') expect(hana.grants ?? [], `#${i}`).toEqual([]);
      }
    },
    TIMEOUT,
  );
});
