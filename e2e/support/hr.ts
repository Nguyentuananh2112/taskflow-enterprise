import { randomUUID } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

import { apiAddMember, apiLogin, apiRegister, type Seeded } from './api';
import { API_URL, WEB_ORIGIN } from './env';
import { newUser, type E2EUser } from './fixtures';

// Mốc 3 (T-042, test-spec-hr §9) — seed chấm công / nghỉ phép CHỈ qua API công khai, theo contract thật:
// attendance = T-038 (A, cdd3096 + 0fb023f), leave = T-039 (D, contracts/leave), grants = T-037 (PUT `{ grants }`).
// Lịch mặc định S0: T2–T7 08:00–17:30, Asia/Ho_Chi_Minh (workspace mới không có dòng lịch).

export const VN_TZ = 'Asia/Ho_Chi_Minh';

interface CallOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  expected: number;
}

/** Như `call` của api.ts nhưng nhận header thêm (Idempotency-Key) và trả nguyên `data` (204 ⇒ undefined). */
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

const ws = (s: Pick<Seeded, 'workspaceId'>) => `/workspaces/${s.workspaceId}`;

export interface HrPerson {
  user: E2EUser;
  userId: string;
  accessToken: string;
}

/** Bối cảnh §0.2 rút gọn cho E2E: Olivia OWNER, Hana MEMBER + HR_MANAGE, Mia MEMBER, Vic VIEWER — cùng 1 ws. */
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
): Promise<HrPerson> {
  const user = newUser(label);
  const s = await apiRegister(request, user);
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
    join(request, olivia, `${label}-hana`, 'MEMBER'),
    join(request, olivia, `${label}-mia`, 'MEMBER'),
    join(request, olivia, `${label}-vic`, 'VIEWER'),
  ]);
  if (hanaIsHr) await apiSetGrants(request, olivia, hana.userId, ['HR_MANAGE']);
  return { olivia, hana, mia, vic };
}

export const apiSetGrants = (
  request: APIRequestContext,
  owner: Seeded,
  userId: string,
  grants: string[],
) =>
  hrCall(request, 'PUT', `${ws(owner)}/members/${userId}/grants`, {
    token: owner.accessToken,
    body: { grants },
    expected: 200,
  });

export interface TodayCard {
  firstIn: string | null;
  lastOut: string | null;
  inProgress: boolean;
  timezone: string;
}

export const apiMyToday = (request: APIRequestContext, s: Seeded, who: HrPerson) =>
  hrCall<TodayCard>(request, 'GET', `${ws(s)}/attendance/me/today`, {
    token: who.accessToken,
    expected: 200,
  });

/** Check-in qua API (Idempotency-Key mới). `expected` 201 mặc định; VIEWER ⇒ 403. */
export const apiCheckIn = (request: APIRequestContext, s: Seeded, token: string, expected = 201) =>
  hrCall<TodayCard>(request, 'POST', `${ws(s)}/attendance/check-in`, {
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
  s: Seeded,
  who: HrPerson,
  body: { type: string; startDate: string; endDate: string; reason?: string },
) =>
  hrCall<LeaveRef>(request, 'POST', `${ws(s)}/leave-requests`, {
    token: who.accessToken,
    body: { dayPart: 'FULL', ...body },
    expected: 201,
  });

export const apiDecideLeave = (
  request: APIRequestContext,
  s: Seeded,
  by: HrPerson,
  leave: LeaveRef,
  action: 'approve' | 'reject',
  note?: string,
) =>
  hrCall<LeaveRef>(request, 'POST', `${ws(s)}/leave-requests/${leave.id}/${action}`, {
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
  s: Seeded,
  by: HrPerson,
  userId: string,
  body: { kind: 'IN' | 'OUT'; date: string; time: string; reason: string },
) =>
  hrCall(request, 'POST', `${ws(s)}/attendance/events`, {
    token: by.accessToken,
    body: { userId, ...body },
    expected: 201,
  });

/** `PUT holidays/:date { name }` — ngày tương lai không cần lý do. */
export const apiPutHoliday = (
  request: APIRequestContext,
  s: Seeded,
  by: HrPerson,
  date: string,
  name: string,
) =>
  hrCall(request, 'PUT', `${ws(s)}/attendance/holidays/${date}`, {
    token: by.accessToken,
    body: { name },
    expected: 200,
  });

// ---------------------------------------------------------------- ngày giờ theo lịch S0

/** YYYY-MM-DD của `d` theo giờ VN. */
export const vnDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: VN_TZ });

/** HH:mm theo giờ VN — khớp cách thẻ chấm công hiển thị (`hourCycle h23`). */
export const vnHm = (d = new Date()) =>
  d.toLocaleTimeString('en-GB', {
    timeZone: VN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

/** Hôm nay (giờ VN) là ngày làm việc của S0 (T2–T7)? Thẻ chỉ nhắc "chưa chấm vào" trong ngày làm việc. */
export const vnIsWorkday = (d = new Date()) =>
  new Intl.DateTimeFormat('en-US', { timeZone: VN_TZ, weekday: 'short' }).format(d) !== 'Sun';

/** Ngày làm việc S0 (bỏ Chủ nhật) cách hôm nay (VN) ≥ `offset` ngày. */
export function vnWorkday(offset: number): string {
  const d = new Date(`${vnDate()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "dd/MM" — đuôi nhãn ngày ở bảng công ("T5, 15/10") và trong text thông báo đơn nghỉ. */
export const ddMm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
