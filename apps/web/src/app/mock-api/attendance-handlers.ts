import { Uuid } from '@taskflow/contracts/common';
import { http, type HttpHandler } from 'msw';

import { AttendanceMonthDto, AttendanceTodayDto, MonthQuery } from '@/shared/api/m3-provisional';

import type { MockAttendance } from './mock-attendance';
import { MOCK_TZ } from './mock-attendance';
import type { MockDb } from './mock-db';
import { requireMember, type MemberContext } from './mock-guard';
import { fail, ok, parseQuery } from './respond';

// Chấm công (attendance-leave.md §5, mã lỗi đã chốt với A — T-038): VIEWER 403 `attendance:self`;
// Idempotency-Key bắt buộc UUID (400); lặp cùng key + cùng loại ⇒ 200 trả hôm nay hiện tại (không tạo
// lượt mới); cùng key khác loại ⇒ 422 `idempotency_key_reused`; IN lần 2 ⇒ 409 `already_checked_in`;
// OUT khi chưa IN ⇒ 422 `not_checked_in`. Giờ chấm do server ghi nhận.

const selfOnly = (ctx: MemberContext) =>
  ctx.membership.role === 'VIEWER'
    ? fail(403, 'FORBIDDEN_ACCESS', { required: 'attendance:self' })
    : null;

export function createAttendanceHandlers(
  baseUrl: string,
  db: MockDb,
  attendance: MockAttendance,
): HttpHandler[] {
  const base = `${baseUrl}/workspaces/:wsId/attendance`;

  const punch = (kind: 'IN' | 'OUT') =>
    http.post(`${base}/${kind === 'IN' ? 'check-in' : 'check-out'}`, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = selfOnly(ctx.ok);
      if (denied) return denied;
      const wsId = String(params.wsId);
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
          : fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'idempotency_key_reused' });
      }
      const today = attendance.punches(wsId, userId, attendance.today());
      const hasIn = today.some((p) => p.kind === 'IN');
      if (kind === 'IN' && hasIn) {
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'already_checked_in' });
      }
      if (kind === 'OUT' && !hasIn) {
        return fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'not_checked_in' });
      }
      attendance.punch(wsId, userId, kind, key);
      return ok(AttendanceTodayDto, attendance.todayDto(wsId, userId));
    });

  return [
    http.get(`${base}/me/today`, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = selfOnly(ctx.ok);
      if (denied) return denied;
      return ok(AttendanceTodayDto, attendance.todayDto(String(params.wsId), ctx.ok.user.id));
    }),
    http.get(`${base}/me`, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = selfOnly(ctx.ok);
      if (denied) return denied;
      const query = parseQuery(request, MonthQuery);
      if (query.response) return query.response;
      const [year, month] = query.data.month.split('-').map(Number) as [number, number];
      const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const days = Array.from({ length: daysIn }, (_, i) =>
        attendance.summarize(
          String(params.wsId),
          ctx.ok.user.id,
          `${query.data.month}-${String(i + 1).padStart(2, '0')}`,
        ),
      );
      return ok(AttendanceMonthDto, { month: query.data.month, timezone: MOCK_TZ, days });
    }),
    punch('IN'),
    punch('OUT'),
  ];
}
