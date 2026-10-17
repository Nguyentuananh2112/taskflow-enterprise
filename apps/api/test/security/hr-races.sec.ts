import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { Actors, type Actor } from './harness/actors';
import { SEC_CLOCK_ANCHOR, vnDateOf } from './harness/clock';
import {
  HR,
  hrClockEnv,
  leaveOf,
  seedHr,
  setGrants,
  submitLeave,
  withKey,
  workday,
} from './harness/hr';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase, useApi } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// CC-HR-* (test-spec-hr §8, T-042) — đua HỘP ĐEN qua HTTP + Postgres thật, ×20 mỗi ca. Đặt ở suite bảo
// mật thay vì `test/integration` vì module chưa có (không import được use case); kiểm cùng bất biến:
// đúng một bên thắng, bên thua nhận mã đúng, DB không ở trạng thái nửa vời. Pending theo vé (pending.ts).

// Giờ nghiệp vụ neo thứ Ba 10:00 VN (harness/clock.ts) — cùng mốc với workday()/todayVn().
const api = useApi(hrClockEnv());
const actors = new Actors(api);
/**
 * Số vòng mỗi ca (mặc định 20). SEC_HR_RACE_RUNS=200 để xác nhận race hiếm (vd CC-HR-02 ~1/20 trước d6ac8f7) —
 * kèm `-t "CC-HR-02"` để chỉ chạy một ca. Timeout ca giãn theo số vòng.
 */
const RUNS = (() => {
  const raw = process.env.SEC_HR_RACE_RUNS;
  if (raw === undefined) return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`SEC_HR_RACE_RUNS phải là số nguyên ≥ 1, nhận "${raw}"`);
  return n;
})();
const AREA = 'Mốc 3 HR races';
const TIMEOUT = 180_000 * Math.max(1, Math.ceil(RUNS / 20));
/**
 * CC-HR-04: hai đơn phải CÙNG năm số dư (mỗi năm 12 ngày riêng). `workday(60..100)` từng vắt sang năm sau khi chạy
 * từ tháng 10 ⇒ hai đơn khác năm, cả hai 201 đúng luật (T-039 gate). Hai khoảng 12 ngày lịch cố định của năm sau
 * (12 ngày lịch có ≤ 2 Chủ nhật ⇒ 10–12 ngày làm việc S0, ws mới không có ngày lễ) ⇒ tổng ≥ 20 > 12, mỗi đơn ≤ 12.
 */
/** Năm sau theo MỐC (không theo giờ máy). Các đơn cần "cùng một năm số dư" dùng ngày cố định của năm này. */
const NEXT_YEAR = String(Number(vnDateOf(SEC_CLOCK_ANCHOR).slice(0, 4)) + 1);
/** CC-HR-13: thứ Hai đầu tiên của tháng 6 năm sau và 2 ngày kế (T2, T3, T4 — đều là ngày làm việc S0). */
function mondaySpan(): [string, string, string] {
  const d = new Date(`${NEXT_YEAR}-06-01T00:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const at = (n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return [at(0), at(1), at(2)];
}
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
  // Mỗi vòng đăng ký 7 user + 5 lời mời từ cùng IP ⇒ ×20 vượt limiter (T-039 gate: 429 từ vòng #5) — xóa bộ đếm
  // trước mỗi vòng như workspace-races.sec.ts. Không ảnh hưởng bất biến của ca: bộ đếm không phải dữ liệu nghiệp vụ.
  await flushRateLimitCounters();
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
    '2 check-in song song CÙNG Idempotency-Key ⇒ một 201 + một 200 (replay), cùng firstIn',
    AREA,
    async () => {
      // Chạy HẾT các vòng rồi mới đánh giá ⇒ biết tổng số vòng đỏ (race hiếm, TL cần đếm), không dừng ở vòng đầu.
      const red: string[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const key = randomUUID();
        const rs = await Promise.all([
          withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken, key),
          withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken, key),
        ]);
        // Body = AttendanceTodayDto (không có id lượt chấm — A/E) ⇒ so firstIn: replay không tạo lượt mới.
        const firstIn = rs.map(
          (r) => (r.json as { data: { firstIn: string | null } }).data.firstIn,
        );
        const st = statuses(rs);
        if (st[0] !== 200 || st[1] !== 201 || firstIn[0] === null || firstIn[0] !== firstIn[1]) {
          red.push(
            `#${String(i)}: [${st.join(', ')}] firstIn ${String(firstIn[0])} / ${String(firstIn[1])}`,
          );
        }
      }
      expect(red, `${String(red.length)}/${String(RUNS)} vòng đỏ`).toEqual([]);
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
            startDate: `${NEXT_YEAR}-03-02`,
            endDate: `${NEXT_YEAR}-03-13`,
          }),
          submitLeave(actors, t.mia, t.ws, {
            type: 'ANNUAL',
            startDate: `${NEXT_YEAR}-04-06`,
            endDate: `${NEXT_YEAR}-04-17`,
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
      const year = Number(NEXT_YEAR);
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const [submit, patch] = await Promise.all([
          submitLeave(actors, t.mia, t.ws, {
            type: 'ANNUAL',
            // 11 ngày lịch ⇒ 9–10 ngày công S0, cùng năm số dư `year`.
            startDate: `${NEXT_YEAR}-05-04`,
            endDate: `${NEXT_YEAR}-05-14`,
          }),
          actors.json('PATCH', HR.balance(t.ws, t.mia.userId, year), t.hana.accessToken, {
            adjustmentDays: -6,
            note: 'race',
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
      const year = Number(NEXT_YEAR);
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const l = leaveOf(
          await submitLeave(actors, t.mia, t.ws, {
            type: 'ANNUAL',
            // 11 ngày lịch ⇒ 9–10 ngày công S0, cùng năm số dư `year`.
            startDate: `${NEXT_YEAR}-05-04`,
            endDate: `${NEXT_YEAR}-05-14`,
          }),
        );
        const [ap] = await Promise.all([
          decide(t.hana, t.ws, l.id, 'approve', l.version),
          actors.json('PATCH', HR.balance(t.ws, t.mia.userId, year), t.olivia.accessToken, {
            adjustmentDays: -6,
            note: 'race',
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
          decide(t.olivia, t.ws, l.id, 'reject', l.version, { note: 'race' }),
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
      const year = Number(NEXT_YEAR);
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const l = leaveOf(
          await submitLeave(actors, t.mia, t.ws, {
            type: 'ANNUAL',
            startDate: `${NEXT_YEAR}-05-18`,
            endDate: `${NEXT_YEAR}-05-19`,
          }),
        );
        const ap = leaveOf(await decide(t.hana, t.ws, l.id, 'approve', l.version));
        const rs = await Promise.all([
          decide(t.hana, t.ws, l.id, 'revoke', ap.version, { note: 'race' }),
          decide(t.mia, t.ws, l.id, 'cancel', ap.version),
        ]);
        expect(statuses(rs), `#${i}`).toEqual([200, 409]);
        const bal = (await actors.json('GET', HR.myBalance(t.ws, year), t.mia.accessToken))
          .json as { data: { remainingDays: number } };
        expect(bal.data.remainingDays, `#${i}`).toBe(12);
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
        const res = await submitLeave(actors, t.mia, t.ws, {
          type: 'UNPAID',
          // Bước 2: workday() dời Chủ nhật sang thứ Hai ⇒ bước 1 có thể trùng ngày vòng trước (409 overlap).
          startDate: workday(100 + 2 * i),
          endDate: workday(100 + 2 * i),
        });
        expect(res.status, `#${i} submit: ${res.text.slice(0, 200)}`).toBe(201);
        const l = leaveOf(res);
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
      const year = Number(NEXT_YEAR);
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
        // So `data` (số dư) — envelope có meta.timestamp/requestId khác nhau mỗi request.
        const balances = rs.map((r) => JSON.stringify((r.json as { data: unknown }).data));
        expect(new Set(balances).size, `#${i}: ${balances.join(' | ')}`).toBe(1);
      }
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-13',
    'thêm ngày lễ ‖ approve đơn chứa ngày đó ⇒ số ngày đọc lại khớp lịch sau cùng',
    AREA,
    async () => {
      // Đơn ANNUAL T2–T4 (3 ngày công S0) của năm sau; HR thêm lễ vào T3 ĐÚNG lúc duyệt. `days` không lưu mà
      // tính khi đọc (D-H3a) ⇒ dù bên nào commit trước, đọc lại luôn là 2 ngày và số dư đã dùng là 2.
      const [mon, tue, wed] = mondaySpan();
      for (let i = 0; i < RUNS; i += 1) {
        const t = await freshPair();
        const l = leaveOf(
          await submitLeave(actors, t.mia, t.ws, { type: 'ANNUAL', startDate: mon, endDate: wed }),
        );
        expect(l.status, `#${i}`).toBe('PENDING');
        const [holiday, approve] = await Promise.all([
          actors.json('PUT', HR.holiday(t.ws, tue), t.hana.accessToken, {
            name: `Lễ CC-HR-13 #${String(i)}`,
          }),
          decide(t.hana, t.ws, l.id, 'approve', l.version),
        ]);
        expect(
          [holiday.status, approve.status],
          `#${i}: ${holiday.text.slice(0, 120)} | ${approve.text.slice(0, 120)}`,
        ).toEqual([200, 200]);
        const mine = (await actors.json('GET', HR.myLeaveRequests(t.ws), t.mia.accessToken))
          .json as { data: { id: string; status: string; days: number }[] };
        expect(
          mine.data.find((r) => r.id === l.id),
          `#${i}`,
        ).toMatchObject({ status: 'APPROVED', days: 2 });
        const bal = (
          await actors.json('GET', HR.myBalance(t.ws, Number(NEXT_YEAR)), t.mia.accessToken)
        ).json as { data: { usedDays: number; pendingDays: number; remainingDays: number } };
        expect(bal.data, `#${i}`).toMatchObject({ usedDays: 2, pendingDays: 0, remainingDays: 10 });
      }
    },
    TIMEOUT,
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
