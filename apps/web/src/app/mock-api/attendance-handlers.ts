import { Uuid } from '@taskflow/contracts/common';
import { http, type HttpHandler } from 'msw';

import {
  AttendanceMonthDto,
  AttendanceTodayDto,
  AttendanceMonthQuery,
  AttendanceEventsDto,
  MyAttendanceEventsQuery,
} from '@taskflow/contracts/attendance';

import type { MockAttendance } from './mock-attendance';
import { MOCK_TZ, localDate } from './mock-attendance';
import { totalsOf } from './mock-hr';
import type { MockDb } from './mock-db';
import { COMPANY_SCOPE, requireCompany } from './mock-guard';
import { fail, ok, parseQuery } from './respond';

// Chấm công cấp CÔNG TY (Mốc 3.5 — route `/attendance/…`; attendance-leave.md §5, mã lỗi A — T-038): Admin 403
// `attendance:self`;
// Idempotency-Key bắt buộc UUID (400); lặp cùng key + cùng loại ⇒ 200 trả hôm nay hiện tại (không tạo
// lượt mới); cùng key khác loại ⇒ 422 `IDEMPOTENCY_KEY_REUSED`; IN lần 2 ⇒ 409 `already_checked_in`;
// OUT khi chưa IN ⇒ 422 `NOT_CHECKED_IN`. Giờ chấm do server ghi nhận.

export function createAttendanceHandlers(
  baseUrl: string,
  db: MockDb,
  attendance: MockAttendance,
): HttpHandler[] {
  const base = `${baseUrl}/attendance`;

  const punch = (kind: 'IN' | 'OUT') =>
    http.post(`${base}/${kind === 'IN' ? 'check-in' : 'check-out'}`, ({ request }) => {
      const ctx = requireCompany(request, db, 'attendance:self');
      if (ctx.response) return ctx.response;
      const wsId = COMPANY_SCOPE;
      const userId = ctx.ok.user.id;
      const key = request.headers.get('idempotency-key');
      if (!Uuid.safeParse(key).success || key === null) {
        return fail(400, 'VALIDATION_ERROR', {
          issues: [{ path: ['Idempotency-Key'], code: 'invalid_format', message: 'Cần UUID' }],
        });
      }
      const seen = attendance.findByKey(wsId, userId, key);
      if (seen) {
        return seen.kind === kind
          ? ok(AttendanceTodayDto, attendance.todayDto(wsId, userId))
          : fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'IDEMPOTENCY_KEY_REUSED' });
      }
      const today = attendance.punches(wsId, userId, attendance.today()).filter((p) => !p.voided);
      const hasIn = today.some((p) => p.kind === 'IN');
      if (kind === 'IN' && hasIn) {
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'already_checked_in' });
      }
      if (kind === 'OUT' && !hasIn) {
        return fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'NOT_CHECKED_IN' });
      }
      attendance.punch(wsId, { id: userId, fullName: ctx.ok.user.fullName }, kind, key, {
        ip: '127.0.0.1',
        userAgent: request.headers.get('user-agent'),
      });
      return ok(AttendanceTodayDto, attendance.todayDto(wsId, userId));
    });

  return [
    http.get(`${base}/me/today`, ({ request }) => {
      const ctx = requireCompany(request, db, 'attendance:self');
      if (ctx.response) return ctx.response;
      return ok(AttendanceTodayDto, attendance.todayDto(COMPANY_SCOPE, ctx.ok.user.id));
    }),
    http.get(`${base}/me`, ({ request }) => {
      const ctx = requireCompany(request, db, 'attendance:self');
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, AttendanceMonthQuery);
      if (query.response) return query.response;
      const [year, month] = query.data.month.split('-').map(Number) as [number, number];
      const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const wsId = COMPANY_SCOPE;
      // Ngày trước khi gia nhập (theo lịch) không phải ngày vắng ⇒ NOT_EMPLOYED (TL chốt).
      const joinedAt = db.company.joinedAt(ctx.ok.user.id);
      const joinedDate = joinedAt ? localDate(joinedAt) : undefined;
      const days = Array.from({ length: daysIn }, (_, i) =>
        attendance.summarize(
          wsId,
          ctx.ok.user.id,
          `${query.data.month}-${String(i + 1).padStart(2, '0')}`,
          joinedDate,
        ),
      );
      return ok(AttendanceMonthDto, {
        month: query.data.month,
        timezone: MOCK_TZ,
        days,
        totals: totalsOf(days, attendance.today()), // như API (T-046)
      });
    }),
    http.get(`${base}/me/events`, ({ request }) => {
      const ctx = requireCompany(request, db, 'attendance:self');
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, MyAttendanceEventsQuery);
      if (query.response) return query.response;
      const events = attendance.events(COMPANY_SCOPE, ctx.ok.user.id, query.data.date);
      return ok(AttendanceEventsDto, { timezone: MOCK_TZ, events });
    }),
    punch('IN'),
    punch('OUT'),
  ];
}
