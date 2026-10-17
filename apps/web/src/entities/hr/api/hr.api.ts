import {
  AttendanceCompanyTodayDto,
  AttendanceEventChangeDto,
  AttendanceEventsDto,
  AttendanceMemberMonthDto,
  HolidayDto,
  WorkScheduleDto,
  type AdjustAttendanceBody,
  type CreateWorkScheduleBody,
} from '@taskflow/contracts/attendance';
import type { LeaveStatus } from '@taskflow/contracts/hr';
import {
  LeaveBalanceRowDto,
  LeaveRequestDto,
  type AdjustLeaveBalanceBody,
} from '@taskflow/contracts/leave';
import * as z from 'zod';

import { http } from '@/shared/api';

// Mốc 3.5 (ADR-136): HR cấp CÔNG TY — route gốc `/attendance`, `/leave`, không còn `wsId` (company-level.md §4).
const att = '/attendance';
const enc = encodeURIComponent;

/** Chấm công phía HR (`hr:manage` — attendance-leave.md §5). */
export const hrAttendanceApi = {
  today: () => http.get(`${att}/today`, { schema: AttendanceCompanyTodayDto }),
  /** Một trang 50 nhân viên của bảng công tháng (cursor). */
  month: (month: string, cursor?: string) =>
    http.request('GET', att, {
      schema: z.array(AttendanceMemberMonthDto),
      query: { month, cursor, limit: 50 },
    }),
  /** CSV cả công ty: fetch (Bearer) → Blob (§5 — không dùng URL ký). */
  exportCsv: (month: string) =>
    http.download(`${att}/export.csv`, { query: { month }, accept: 'text/csv' }),
  events: (userId: string, date: string) =>
    http.get(`${att}/events`, { schema: AttendanceEventsDto, query: { userId, date } }),
  adjust: (body: AdjustAttendanceBody) =>
    http.post(`${att}/events`, { schema: AttendanceEventChangeDto, body }),
  void: (eventId: string, reason: string) =>
    http.post(`${att}/events/${enc(eventId)}/void`, {
      schema: AttendanceEventChangeDto,
      body: { reason },
    }),
  schedules: () => http.get(`${att}/schedules`, { schema: z.array(WorkScheduleDto) }),
  createSchedule: (body: CreateWorkScheduleBody) =>
    http.post(`${att}/schedules`, { schema: WorkScheduleDto, body }),
  holidays: (year: number) =>
    http.get(`${att}/holidays`, { schema: z.array(HolidayDto), query: { year } }),
  putHoliday: (date: string, body: { name: string; reason?: string }) =>
    http.put(`${att}/holidays/${enc(date)}`, { schema: HolidayDto, body }),
  /** 204 idempotent; không body (A) — chỉ ngày đã qua (OWNER) mới gửi JSON `{ reason }`. */
  deleteHoliday: (date: string, reason?: string) =>
    http.delete(`${att}/holidays/${enc(date)}`, {
      schema: z.undefined(),
      ...(reason ? { body: { reason } } : {}),
    }),
};

/** Nghỉ phép phía HR (§9 — `expectedVersion` cho mọi chuyển trạng thái). */
export const hrLeaveApi = {
  list: (status: LeaveStatus | undefined, cursor?: string) =>
    http.request('GET', `/leave/requests`, {
      schema: z.array(LeaveRequestDto),
      query: { status, cursor, limit: 50 },
    }),
  decide: (
    id: string,
    action: 'approve' | 'reject' | 'revoke',
    body: { expectedVersion: number; note?: string | null },
  ) =>
    http.post(`/leave/requests/${enc(id)}/${action}`, {
      schema: LeaveRequestDto,
      body,
    }),
  balances: (year: number, cursor?: string) =>
    http.request('GET', `/leave/balances`, {
      schema: z.array(LeaveBalanceRowDto),
      query: { year, cursor, limit: 50 },
    }),
  adjustBalance: (userId: string, year: number, body: AdjustLeaveBalanceBody) =>
    http.patch(`/leave/balances/${enc(userId)}/${year}`, {
      schema: LeaveBalanceRowDto,
      body,
    }),
};
