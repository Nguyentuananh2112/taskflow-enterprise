import { randomUUID } from 'node:crypto';

import { randomIp, type Actor, type Actors } from './actors';
import type { CompanyActors } from './company';
import { SEC_CLOCK_ANCHOR, addDays, vnDateOf } from './clock';
import type { RawResponse } from './http-client';
import type { ApiUnderTest } from './suite';

/**
 * Mốc 3 (T-042) — helper hộp đen cho chấm công / nghỉ phép / thông báo. Đường dẫn và tên trường lấy
 * theo `docs/design/attendance-leave.md` §5/§9 (contract Zod của T-037…T-040 chưa có lúc viết). Khi
 * contract chốt, chỉ sửa ở file này — các ca `hr*.sec.ts` không lặp chuỗi đường dẫn.
 *
 * Đã đối chiếu (2026-10-16): leave = contracts/leave @ ed5b923 (D) — decide/revoke/PATCH balance dùng `note`,
 * cancel bắt buộc `expectedVersion`, số dư `remainingDays/pendingDays/usedDays`; attendance = contracts/attendance
 * @ 6c732e4 (A) — query strict, ADJUSTMENT `{ userId, kind, date, time, nextDay?, reason }`, void `{ reason }`;
 * route attendance = cdd3096 (A, feat/T-038-attendance) — khớp bảng `HR` dưới đây.
 */
export const HR = {
  meToday: (ws: string) => `/workspaces/${ws}/attendance/me/today`,
  me: (ws: string, month: string) => `/workspaces/${ws}/attendance/me?month=${month}`,
  checkIn: (ws: string) => `/workspaces/${ws}/attendance/check-in`,
  checkOut: (ws: string) => `/workspaces/${ws}/attendance/check-out`,
  today: (ws: string) => `/workspaces/${ws}/attendance/today`,
  month: (ws: string, month: string) => `/workspaces/${ws}/attendance?month=${month}`,
  exportCsv: (ws: string, month: string) =>
    `/workspaces/${ws}/attendance/export.csv?month=${encodeURIComponent(month)}`,
  events: (ws: string) => `/workspaces/${ws}/attendance/events`,
  /** f8ddb7b: lượt thô của một nhân viên trong 1 ngày công (hr:manage, có IP/UA, gồm lượt đã hủy). */
  eventsOf: (ws: string, userId: string, date: string) =>
    `/workspaces/${ws}/attendance/events?userId=${userId}&date=${date}`,
  /** f8ddb7b: lượt thô của chính mình (attendance:self). */
  myEvents: (ws: string, date: string) => `/workspaces/${ws}/attendance/me/events?date=${date}`,
  voidEvent: (ws: string, id: string) => `/workspaces/${ws}/attendance/events/${id}/void`,
  schedules: (ws: string) => `/workspaces/${ws}/attendance/schedules`,
  holiday: (ws: string, date: string) => `/workspaces/${ws}/attendance/holidays/${date}`,
  leaveRequests: (ws: string) => `/workspaces/${ws}/leave-requests`,
  myLeaveRequests: (ws: string) => `/workspaces/${ws}/leave-requests?mine=1`,
  leaveAction: (ws: string, id: string, action: 'cancel' | 'approve' | 'reject' | 'revoke') =>
    `/workspaces/${ws}/leave-requests/${id}/${action}`,
  myBalance: (ws: string, year: number) => `/workspaces/${ws}/leave-balances/me?year=${year}`,
  balance: (ws: string, userId: string, year: number) =>
    `/workspaces/${ws}/leave-balances/${userId}/${year}`,
  grants: (ws: string, userId: string) => `/workspaces/${ws}/members/${userId}/grants`,
  notifications: '/me/notifications',
  notificationRead: (id: string) => `/me/notifications/${id}/read`,
  /** T-037 (B chốt): OWNER-only (`hr:grant`), mới nhất trước, cursor kind riêng. */
  auditLogs: (ws: string) => `/workspaces/${ws}/hr-audit-logs`,
} as const;

export interface HrTenant {
  ws: string;
  olivia: Actor; // OWNER
  hana: Actor; // MEMBER + HR_MANAGE
  pam: Actor; // PM
  mia: Actor; // MEMBER
  max: Actor; // MEMBER
  vic: Actor; // VIEWER
  otto: Actor; // OWNER của ws khác
  wsB: string;
}

/** Bối cảnh chuẩn của test-spec-hr §0.2 (trừ Rex — ca cần "người đã rời" tự dựng). */
export async function seedHr(actors: CompanyActors): Promise<HrTenant> {
  const reg = (l: string) => actors.register(`hr-${l}`);
  const [olivia, hana, pam, mia, max, vic, otto] = await Promise.all([
    reg('olivia'),
    reg('hana'),
    reg('pam'),
    reg('mia'),
    reg('max'),
    reg('vic'),
    reg('otto'),
  ]);
  const t = { olivia, hana, pam, mia, max, vic, otto };
  const ws = t.olivia.defaultWorkspaceId;
  await actors.addMember(t.olivia, ws, t.hana, 'MEMBER');
  await actors.addMember(t.olivia, ws, t.pam, 'PM');
  await actors.addMember(t.olivia, ws, t.mia, 'MEMBER');
  await actors.addMember(t.olivia, ws, t.max, 'MEMBER');
  await actors.addMember(t.olivia, ws, t.vic, 'VIEWER');
  const granted = await setGrants(actors, t.olivia, ws, t.hana.userId, ['HR_MANAGE']);
  if (granted.status !== 200) throw new Error(`cấp HR_MANAGE: ${granted.status} ${granted.text}`);
  return { ws, wsB: t.otto.defaultWorkspaceId, ...t };
}

export const setGrants = (
  actors: Actors,
  by: Actor,
  ws: string,
  userId: string,
  grants: string[],
) => actors.json('PUT', HR.grants(ws, userId), by.accessToken, { grants });

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
 * Ngày làm việc (T2–T7 của lịch mặc định S0 — workspace mới không có dòng lịch) cách "hôm nay" ≥ `offset` ngày.
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
  who: Actor,
  ws: string,
  body: { type: string; startDate: string; endDate: string; dayPart?: string; reason?: string },
) => actors.json('POST', HR.leaveRequests(ws), who.accessToken, { dayPart: 'FULL', ...body });

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
 * HR thêm lượt ADJUSTMENT — `AdjustAttendanceBody` strict (aac6aaa): giờ nhập theo LỊCH của `date`
 * (`time` HH:mm, `nextDay` cho OUT sau nửa đêm), KHÔNG có `occurredAt`. 201 ⇒ `{ event, day }`.
 */
export const adjust = (
  actors: Actors,
  by: Actor,
  ws: string,
  userId: string,
  kind: 'IN' | 'OUT',
  time = '08:00',
  reason = 'F test',
) =>
  actors.json('POST', HR.events(ws), by.accessToken, {
    userId,
    kind,
    date: todayVn(),
    time,
    reason,
  });

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

/** Env cho `useApi()` của các file HR: API chạy theo cùng mốc với helper ngày ở trên. */
export const hrClockEnv = (anchor: string = SEC_CLOCK_ANCHOR) => ({ TEST_CLOCK_ANCHOR: anchor });
