import { randomUUID } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

import { apiAddMember, apiLogin } from './api';
import { vnDateOf } from '../../apps/api/test/security/harness/clock';

import { apiCreateUser, apiRegister, type Seeded } from './company';
import { API_URL, E2E_CLOCK_ANCHOR, WEB_ORIGIN } from './env';
import { newUser, type E2EUser } from './fixtures';

// Mốc 3.5 (T-066, test-spec-company §6.3) — chấm công / nghỉ phép / HR thuộc CÔNG TY (design company-level §4): route gốc
// `attendance/…`, `leave/…`, grant `HR_MANAGE` cấp ở `admin/access`. Workspace chỉ còn là dự án (Olivia OWNER, Vic VIEWER
// dự án — vẫn là nhân viên). Seed CHỈ qua API công khai. Lịch mặc định S0: T2–T7 08:00–17:30, Asia/Ho_Chi_Minh.
// Một công ty ⇒ HR thấy MỌI ca: không khẳng định số tuyệt đối ở danh sách / chuông của HR (§0.4).

export const VN_TZ = 'Asia/Ho_Chi_Minh';

interface CallOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  expected: number;
}

/** Như `call` của http.ts nhưng nhận header thêm (Idempotency-Key) và trả nguyên `data` (204 ⇒ undefined). */
export async function hrCall<T>(
  request: APIRequestContext,
  method: string,
  path: string,
  { token, body, headers = {}, expected }: CallOptions,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, {
    method,
    headers: {
      origin: WEB_ORIGIN,
      // A (cdd3096): POST/PUT luôn cần JSON — middleware 415 chạy trước auth, kể cả check-in không body.
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(method === 'GET' ? {} : { data: JSON.stringify(body ?? {}) }),
  });
  if (res.status() !== expected) {
    throw new Error(
      `${method} ${path} — mong đợi ${String(expected)}, nhận ${String(res.status())}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  if (res.status() === 204) return undefined as T;
  return ((await res.json()) as { data: T }).data;
}

export interface HrPerson {
  user: E2EUser;
  userId: string;
  accessToken: string;
}

/**
 * Bối cảnh rút gọn cho E2E: Olivia OWNER workspace dự án; Hana nhân viên + `HR_MANAGE` (cấp công ty); Mia nhân viên;
 * Vic nhân viên, VIEWER của dự án. Cả ba là thành viên ws của Olivia.
 */
export interface HrWorld {
  olivia: Seeded & { user: E2EUser };
  hana: HrPerson;
  mia: HrPerson;
  vic: HrPerson;
}

async function join(
  request: APIRequestContext,
  owner: Seeded,
  label: string,
  role: 'MEMBER' | 'VIEWER',
  grants: 'HR_MANAGE'[] = [],
): Promise<HrPerson> {
  const user = newUser(label);
  const s = await apiCreateUser(request, user, { grants });
  await apiAddMember(request, owner, user, role);
  return { user, userId: s.userId, accessToken: s.accessToken };
}

/**
 * Đăng nhập lại qua API ⇒ access token mới. E2E đặt access TTL 10 s (E2E_ACCESS_TTL, E2E-11): token lúc seed hết
 * hạn trước các lời gọi API ở CUỐI ca (sau thao tác UI / chờ) ⇒ 401 TOKEN_EXPIRED (cổng T-041a, mobile).
 */
export async function refreshed(request: APIRequestContext, who: HrPerson): Promise<HrPerson> {
  return { ...who, accessToken: (await apiLogin(request, who.user)).accessToken };
}

export async function seedHrWorld(
  request: APIRequestContext,
  label: string,
  { hanaIsHr = true }: { hanaIsHr?: boolean } = {},
): Promise<HrWorld> {
  const oliviaUser = newUser(`${label}-olivia`);
  const olivia = { ...(await apiRegister(request, oliviaUser)), user: oliviaUser };
  const [hana, mia, vic] = await Promise.all([
    join(request, olivia, `${label}-hana`, 'MEMBER', hanaIsHr ? ['HR_MANAGE'] : []),
    join(request, olivia, `${label}-mia`, 'MEMBER'),
    join(request, olivia, `${label}-vic`, 'VIEWER'),
  ]);
  return { olivia, hana, mia, vic };
}

export interface TodayCard {
  serverNow: string;
  date: string;
  status: string;
  firstIn: string | null;
  lastOut: string | null;
  inProgress: boolean;
  timezone: string;
}

export const apiMyToday = (request: APIRequestContext, who: HrPerson) =>
  hrCall<TodayCard>(request, 'GET', '/attendance/me/today', {
    token: who.accessToken,
    expected: 200,
  });

/** Check-in qua API (Idempotency-Key mới). `expected` 201 mặc định; Admin ⇒ 403 (không `attendance:self`). */
export const apiCheckIn = (request: APIRequestContext, token: string, expected = 201) =>
  hrCall<TodayCard>(request, 'POST', '/attendance/check-in', {
    token,
    headers: { 'idempotency-key': randomUUID() },
    expected,
  });

export interface LeaveRef {
  id: string;
  version: number;
  status: string;
}

export const apiSubmitLeave = (
  request: APIRequestContext,
  who: HrPerson,
  body: { type: string; startDate: string; endDate: string; reason?: string },
) =>
  hrCall<LeaveRef>(request, 'POST', '/leave/requests', {
    token: who.accessToken,
    body: { dayPart: 'FULL', ...body },
    expected: 201,
  });

export const apiDecideLeave = (
  request: APIRequestContext,
  by: HrPerson,
  leave: LeaveRef,
  action: 'approve' | 'reject',
  note?: string,
) =>
  hrCall<LeaveRef>(request, 'POST', `/leave/requests/${leave.id}/${action}`, {
    token: by.accessToken,
    body:
      note === undefined
        ? { expectedVersion: leave.version }
        : { expectedVersion: leave.version, note },
    expected: 200,
  });

/** ADJUSTMENT (`{ userId, kind, date, time, reason }`) — giờ theo lịch của `date`. */
export const apiAdjust = (
  request: APIRequestContext,
  by: HrPerson,
  userId: string,
  body: { kind: 'IN' | 'OUT'; date: string; time: string; reason: string },
) =>
  hrCall(request, 'POST', '/attendance/events', {
    token: by.accessToken,
    body: { userId, ...body },
    expected: 201,
  });

/** `PUT attendance/holidays/:date { name }` — chỉ dùng ngày từ `reserveDate()` (lịch / ngày lễ dùng chung cả công ty). */
export const apiPutHoliday = (
  request: APIRequestContext,
  by: HrPerson,
  date: string,
  name: string,
) =>
  hrCall(request, 'PUT', `/attendance/holidays/${date}`, {
    token: by.accessToken,
    body: { name },
    expected: 200,
  });

// ---------------------------------------------------------------- ngày giờ theo lịch S0

/**
 * "Hôm nay" (YYYY-MM-DD, giờ VN) của API E2E = ngày của mốc `E2E_CLOCK_ANCHOR` (thứ Ba 10:00 VN), KHÔNG phải ngày
 * máy chạy test. Mốc cách nửa đêm 14 giờ ⇒ thời gian trôi trong một lượt chạy không đổi ngày.
 */
export const vnDate = (): string => vnDateOf(E2E_CLOCK_ANCHOR);

/** HH:mm giờ VN của một thời điểm ISO (vd `serverNow`) — khớp cách thẻ chấm công hiển thị (`hourCycle h23`). */
export const vnHm = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: VN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

/** Ngày làm việc S0 (bỏ Chủ nhật) cách "hôm nay" của mốc ≥ `offset` ngày. */
export function vnWorkday(offset: number): string {
  const d = new Date(`${vnDate()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * §0.4 (ADR-140): ngày lễ của MỘT công ty dùng chung mọi ca ⇒ mỗi lần cấp một ngày làm việc xa (≥ +20 ngày từ mốc),
 * không trùng trong lượt chạy — worker khác (TEST_PARALLEL_INDEX của Playwright) dùng dải riêng 60 ngày.
 */
let reserved = 0;
let lastReserved = '';
export function reserveDate(): string {
  const lane = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  let date: string;
  // vnWorkday bỏ Chủ nhật ⇒ hai offset liền nhau có thể ra cùng ngày (thứ Bảy + 1 = thứ Hai = + 2).
  do date = vnWorkday(20 + lane * 60 + reserved++);
  while (date === lastReserved);
  lastReserved = date;
  return date;
}

/** "dd/MM" — đuôi nhãn ngày ở bảng công ("T5, 15/10") và trong text thông báo đơn nghỉ. */
export const ddMm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
