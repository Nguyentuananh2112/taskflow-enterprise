import {
  AdjustAttendanceBody,
  AttendanceCompanyMonthQuery,
  AttendanceEventParams,
  AttendanceEventsQuery,
  AttendanceMonthQuery,
  CreateWorkScheduleBody,
  DeleteHolidayBody,
  HolidayDateParams,
  HolidayListQuery,
  MyAttendanceEventsQuery,
  PutHolidayBody,
  VoidAttendanceBody,
  WorkspaceParams,
} from '@taskflow/contracts';
import { Router, type RequestHandler } from 'express';
import type * as z from 'zod';

import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { validate } from '../../../core/http/validate';
import {
  permitAttendance,
  requireIdempotencyKey,
  type AttendanceMembership,
} from './attendance-access';
import type { AttendanceController } from './attendance.controller';

export interface AttendanceRouteDeps {
  controller: AttendanceController;
  membership: AttendanceMembership;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

/** Gắn dưới `/api/v1` (mergeParams). */
export const ATTENDANCE_PATH = '/workspaces/:wsId/attendance';

const SELF = 'attendance:self';
const HR = 'hr:manage';
/** Lịch + ngày lễ: mọi thành viên đọc được (thiết kế §5). */
const MEMBER = 'workspace:read';

/**
 * Route chấm công (thiết kế §5). Mỗi route: 401 → 400 params → 404 ws / 403 quyền → [hạn mức riêng] → 400
 * query / body / header → use case. Không cache (IP/UA, giờ chấm là dữ liệu cá nhân — §9).
 */
export function attendanceRoutes(d: AttendanceRouteDeps): Router {
  const router = Router({ mergeParams: true });
  const c = d.controller;
  const noStore: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };
  // Gắn THEO TỪNG ROUTE như task / leave (audit T-028 F1) — dù path này chỉ phủ `/attendance`.
  const base = [noStore, d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated)];
  const guard = (
    params: z.ZodType,
    permission: string,
    input: { body?: z.ZodType; query?: z.ZodType } = {},
    extra: readonly RequestHandler[] = [],
  ) => [
    ...base,
    validate({ params }),
    permitAttendance(d.membership, permission),
    ...extra,
    validate(input),
  ];
  const punch = d.limit(RATE_LIMIT_RULES.attendancePunch);

  // Của chính nhân viên.
  router.get('/me/today', ...guard(WorkspaceParams, SELF), c.meToday);
  router.get('/me', ...guard(WorkspaceParams, SELF, { query: AttendanceMonthQuery }), c.meMonth);
  router.get(
    '/me/events',
    ...guard(WorkspaceParams, SELF, { query: MyAttendanceEventsQuery }),
    c.meEvents,
  );
  router.post(
    '/check-in',
    ...guard(WorkspaceParams, SELF, {}, [...punch, requireIdempotencyKey]),
    c.checkIn,
  );
  router.post(
    '/check-out',
    ...guard(WorkspaceParams, SELF, {}, [...punch, requireIdempotencyKey]),
    c.checkOut,
  );

  // HR.
  router.get('/today', ...guard(WorkspaceParams, HR), c.companyToday);
  router.get(
    '/',
    ...guard(WorkspaceParams, HR, { query: AttendanceCompanyMonthQuery }),
    c.companyMonth,
  );
  router.get(
    '/export.csv',
    ...guard(
      WorkspaceParams,
      HR,
      { query: AttendanceMonthQuery },
      d.limit(RATE_LIMIT_RULES.attendanceExport),
    ),
    c.exportCsv,
  );
  router.get(
    '/events',
    ...guard(WorkspaceParams, HR, { query: AttendanceEventsQuery }),
    c.listEvents,
  );
  router.post('/events', ...guard(WorkspaceParams, HR, { body: AdjustAttendanceBody }), c.adjust);
  router.post(
    '/events/:eventId/void',
    ...guard(AttendanceEventParams, HR, { body: VoidAttendanceBody }),
    c.voidEvent,
  );

  // Lịch + ngày lễ.
  router.get('/schedules', ...guard(WorkspaceParams, MEMBER), c.listSchedules);
  router.post(
    '/schedules',
    ...guard(WorkspaceParams, HR, { body: CreateWorkScheduleBody }),
    c.createSchedule,
  );
  router.get(
    '/holidays',
    ...guard(WorkspaceParams, MEMBER, { query: HolidayListQuery }),
    c.listHolidays,
  );
  router.put(
    '/holidays/:date',
    ...guard(HolidayDateParams, HR, { body: PutHolidayBody }),
    c.putHoliday,
  );
  // DELETE thường không có body ⇒ thiếu body = `{}`.
  router.delete(
    '/holidays/:date',
    ...guard(HolidayDateParams, HR, { body: DeleteHolidayBody.optional().default({}) }),
    c.deleteHoliday,
  );
  return router;
}
