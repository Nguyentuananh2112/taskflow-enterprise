import { randomUUID } from 'node:crypto';

import type { Actors } from './actors';
import type { CompanyActor, CompanyActors, CreateUserOptions } from './company';
import { SEC_CLOCK_ANCHOR, addDays, vnDateOf } from './clock';
import type { RawResponse } from './http-client';
import type { ApiUnderTest } from './suite';
import { randomIp } from './actors';

/**
 * Helper hộp đen chấm công / nghỉ phép / thông báo — Mốc 3.5 "cấp công ty" (T-066, test-spec-company §6.1): route
 * gốc `attendance/…`, `leave/…`, `hr/…` (design company-level §4, A T-063 / D T-064 / B T-061); không còn
 * `workspaces/:wsId`. Quyền HR là grant công ty `HR_MANAGE` cấp ở `PUT admin/access` (A T-061a). Các ca `hr*.sec.ts`
 * không lặp chuỗi đường dẫn — đổi route chỉ sửa ở đây.
 */
export const HR = {
  meToday: '/attendance/me/today',
  me: (month: string) => `/attendance/me?month=${month}`,
  checkIn: '/attendance/check-in',
  checkOut: '/attendance/check-out',
  today: '/attendance/today',
  month: (month: string) => `/attendance?month=${month}`,
  exportCsv: (month: string) => `/attendance/export.csv?month=${encodeURIComponent(month)}`,
  events: '/attendance/events',
  /** Lượt thô của một nhân viên trong 1 ngày công (hr:manage, có IP/UA, gồm lượt đã hủy). */
  eventsOf: (userId: string, date: string) => `/attendance/events?userId=${userId}&date=${date}`,
  /** Lượt thô của chính mình (attendance:self). */
  myEvents: (date: string) => `/attendance/me/events?date=${date}`,
  voidEvent: (id: string) => `/attendance/events/${id}/void`,
  schedules: '/attendance/schedules',
  holiday: (date: string) => `/attendance/holidays/${date}`,
  leaveRequests: '/leave/requests',
  myLeaveRequests: '/leave/requests?mine=1',
  leaveAction: (id: string, action: 'cancel' | 'approve' | 'reject' | 'revoke') =>
    `/leave/requests/${id}/${action}`,
  myBalance: (year: number) => `/leave/balances/me?year=${year}`,
  balance: (userId: string, year: number) => `/leave/balances/${userId}/${year}`,
  access: '/admin/access',
  accessOf: (userId: string) => `/admin/access/${userId}`,
  notifications: '/me/notifications',
  notificationRead: (id: string) => `/me/notifications/${id}/read`,
  /** ADR-136: CHỈ Admin (`company:admin`); HR có `hr:manage` cũng 403 (B-L1). */
  auditLogs: '/hr/audit-logs',
} as const;

/**
 * Bối cảnh chuẩn (test-spec-company §0.2, rút gọn cho hộp đen HR): Ada — Admin (bootstrap, không phải nhân viên);
 * Hana — nhân viên + `HR_MANAGE`; Mia, Max — nhân viên; Vic — nhân viên (trước là VIEWER ws: nay VIEWER chỉ là vai
 * trò dự án, vẫn chấm công); Otto — nhân viên không grant (trước là OWNER ws khác).
 */
export interface HrTenant {
  ada: CompanyActor;
  hana: CompanyActor;
  mia: CompanyActor;
  max: CompanyActor;
  vic: CompanyActor;
  otto: CompanyActor;
}

export async function seedHr(
  actors: CompanyActors,
  opts: Pick<CreateUserOptions, 'startDate'> = {},
): Promise<HrTenant> {
  const make = (label: string, extra: CreateUserOptions = {}) =>
    actors.createUser(`hr-${label}`, { ...opts, ...extra });
  const [hana, mia, max, vic, otto] = await Promise.all([
    make('hana', { grants: ['HR_MANAGE'] }),
    make('mia'),
    make('max'),
    make('vic'),
    make('otto'),
  ]);
  return { ada: actors.ada, hana, mia, max, vic, otto };
}

/** Version hiện tại của người trong `admin/access` (expectedVersion của PUT). Danh sách đủ, không phân trang. */
export async function accessVersion(actors: CompanyActors, userId: string): Promise<number> {
  const res = await actors.json('GET', HR.access, actors.ada.accessToken);
  if (res.status !== 200)
    throw new Error(`GET admin/access ${res.status}: ${res.text.slice(0, 300)}`);
  const row = (res.json as { data: { userId: string; version: number }[] }).data.find(
    (r) => r.userId === userId,
  );
  if (!row) throw new Error(`admin/access không có ${userId}`);
  return row.version;
}

/** Ada đặt grant (giữ EMPLOYEE). Trả RawResponse để ca tự kiểm status (đua, 403 …). */
export async function setGrants(
  actors: CompanyActors,
  userId: string,
  grants: string[],
  by: CompanyActor = actors.ada,
): Promise<RawResponse> {
  const expectedVersion = await accessVersion(actors, userId);
  return actors.json('PUT', HR.accessOf(userId), by.accessToken, {
    role: 'EMPLOYEE',
    grants,
    expectedVersion,
  });
}

/**
 * Request có `Idempotency-Key` (check-in/out) — `Actors.json` không nhận header tùy biến. Không có body thì gửi
 * `{}` (A, cdd3096: POST/PUT luôn cần Content-Type JSON — middleware 415 chạy trước auth).
 */
export function withKey(
  api: ApiUnderTest,
  method: string,
  path: string,
  token: string,
  key: string | undefined = randomUUID(),
  body?: unknown,
): Promise<RawResponse> {
  return api.request({
    method,
    path: `/api/v1${path}`,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      origin: api.webOrigin,
      'idempotency-key': key,
      'x-forwarded-for': randomIp(),
    },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * Ngày làm việc (T2–T7 của lịch mặc định S0 — công ty mới không có dòng lịch) cách "hôm nay" ≥ `offset` ngày.
 * "Hôm nay" = ngày VN của mốc đồng hồ nghiệp vụ (`SEC_CLOCK_ANCHOR`, harness/clock.ts), KHÔNG phải giờ máy.
 */
export function workday(offset: number, anchor: string = SEC_CLOCK_ANCHOR): string {
  const d = new Date(`${addDays(vnDateOf(anchor), offset)}T00:00:00Z`);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const thisMonth = (anchor: string = SEC_CLOCK_ANCHOR) => vnDateOf(anchor).slice(0, 7);

export interface LeaveDto {
  id: string;
  status: string;
  version: number;
}

export function leaveOf(res: RawResponse): LeaveDto {
  return (res.json as { data: LeaveDto }).data;
}

export const submitLeave = (
  actors: Actors,
  who: Pick<CompanyActor, 'accessToken'>,
  body: { type: string; startDate: string; endDate: string; dayPart?: string; reason?: string },
) => actors.json('POST', HR.leaveRequests, who.accessToken, { dayPart: 'FULL', ...body });

export interface AttendanceEventDto {
  id: string;
  userId: string;
  kind: 'IN' | 'OUT';
  source: string;
  workDate: string;
  ip: string | null;
  userAgent: string | null;
  voidedAt: string | null;
}

/**
 * HR thêm lượt ADJUSTMENT — `AdjustAttendanceBody` strict: giờ nhập theo LỊCH của `date` (`time` HH:mm, `nextDay`
 * cho OUT sau nửa đêm), KHÔNG có `occurredAt`. 201 ⇒ `{ event, day }`.
 */
export const adjust = (
  actors: Actors,
  by: Pick<CompanyActor, 'accessToken'>,
  userId: string,
  kind: 'IN' | 'OUT',
  time = '08:00',
  reason = 'F test',
  date: string = todayVn(),
) => actors.json('POST', HR.events, by.accessToken, { userId, kind, date, time, reason });

/** Id lượt chấm từ response ADJUSTMENT / void (`AttendanceEventChangeDto { event, day }`). */
export const eventIdOf = (res: RawResponse): string =>
  (res.json as { data: { event: { id: string } } }).data.event.id;

export const eventsOf = (res: RawResponse): AttendanceEventDto[] =>
  (res.json as { data: { events: AttendanceEventDto[] } }).data.events;

/**
 * Ngày công "hôm nay" theo lịch mặc định S0 (Asia/Ho_Chi_Minh) của mốc đồng hồ nghiệp vụ. Mốc thứ Ba 10:00 ⇒
 * thời gian trôi trong một lượt chạy (vài phút) không đổi ngày.
 */
export const todayVn = (anchor: string = SEC_CLOCK_ANCHOR) => vnDateOf(anchor);

/** Env cho `useCompanyApi()` của các file HR: API (và CLI bootstrap) chạy theo cùng mốc với helper ngày ở trên. */
export const hrClockEnv = (anchor: string = SEC_CLOCK_ANCHOR) => ({ TEST_CLOCK_ANCHOR: anchor });
