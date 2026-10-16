import {
  AttendanceEventChangeDto,
  AttendanceEventsDto,
  type AdjustAttendanceBody,
} from '@taskflow/contracts/attendance';
import type { LeaveStatus } from '@taskflow/contracts/hr';
import {
  LeaveBalanceRowDto,
  LeaveRequestDto,
  type AdjustLeaveBalanceBody,
} from '@taskflow/contracts/leave';
import * as z from 'zod';

import { http } from '@/shared/api';
import {
  CompanyTodayDto,
  HolidayDto,
  TimesheetRowDto,
  WorkScheduleDto,
  type CreateWorkScheduleBody,
} from '@/shared/api/m3-provisional';

const ws = (wsId: string) => `/workspaces/${encodeURIComponent(wsId)}`;
const att = (wsId: string) => `${ws(wsId)}/attendance`;
const enc = encodeURIComponent;

/** Chấm công phía HR (`hr:manage` — attendance-leave.md §5). */
export const hrAttendanceApi = {
  today: (wsId: string) => http.get(`${att(wsId)}/today`, { schema: CompanyTodayDto }),
  /** Một trang 50 nhân viên của bảng công tháng (cursor). */
  month: (wsId: string, month: string, cursor?: string) =>
    http.request('GET', att(wsId), {
      schema: z.array(TimesheetRowDto),
      query: { month, cursor, limit: 50 },
    }),
  /** CSV cả công ty: fetch (Bearer) → Blob (§5 — không dùng URL ký). */
  exportCsv: (wsId: string, month: string) =>
    http.download(`${att(wsId)}/export.csv`, { query: { month }, accept: 'text/csv' }),
  events: (wsId: string, userId: string, date: string) =>
    http.get(`${att(wsId)}/events`, { schema: AttendanceEventsDto, query: { userId, date } }),
  adjust: (wsId: string, body: AdjustAttendanceBody) =>
    http.post(`${att(wsId)}/events`, { schema: AttendanceEventChangeDto, body }),
  void: (wsId: string, eventId: string, reason: string) =>
    http.post(`${att(wsId)}/events/${enc(eventId)}/void`, {
      schema: AttendanceEventChangeDto,
      body: { reason },
    }),
  schedules: (wsId: string) =>
    http.get(`${att(wsId)}/schedules`, { schema: z.array(WorkScheduleDto) }),
  createSchedule: (wsId: string, body: CreateWorkScheduleBody) =>
    http.post(`${att(wsId)}/schedules`, { schema: WorkScheduleDto, body }),
  holidays: (wsId: string, year: number) =>
    http.get(`${att(wsId)}/holidays`, { schema: z.array(HolidayDto), query: { year } }),
  putHoliday: (wsId: string, date: string, body: { name: string; reason?: string }) =>
    http.put(`${att(wsId)}/holidays/${enc(date)}`, { schema: HolidayDto, body }),
  deleteHoliday: (wsId: string, date: string, reason?: string) =>
    http.delete(`${att(wsId)}/holidays/${enc(date)}`, {
      schema: z.undefined(),
      body: reason ? { reason } : {},
    }),
};

/** Nghỉ phép phía HR (§9 — `expectedVersion` cho mọi chuyển trạng thái). */
export const hrLeaveApi = {
  list: (wsId: string, status: LeaveStatus | undefined, cursor?: string) =>
    http.request('GET', `${ws(wsId)}/leave-requests`, {
      schema: z.array(LeaveRequestDto),
      query: { status, cursor, limit: 50 },
    }),
  decide: (
    wsId: string,
    id: string,
    action: 'approve' | 'reject' | 'revoke',
    body: { expectedVersion: number; note?: string | null },
  ) =>
    http.post(`${ws(wsId)}/leave-requests/${enc(id)}/${action}`, {
      schema: LeaveRequestDto,
      body,
    }),
  balances: (wsId: string, year: number, cursor?: string) =>
    http.request('GET', `${ws(wsId)}/leave-balances`, {
      schema: z.array(LeaveBalanceRowDto),
      query: { year, cursor, limit: 50 },
    }),
  adjustBalance: (wsId: string, userId: string, year: number, body: AdjustLeaveBalanceBody) =>
    http.patch(`${ws(wsId)}/leave-balances/${enc(userId)}/${year}`, {
      schema: LeaveBalanceRowDto,
      body,
    }),
};
