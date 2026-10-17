import {
  AdjustAttendanceBody,
  AttendanceCompanyMonthQuery,
  AttendanceEventParams,
  AttendanceEventsQuery,
  AttendanceMonthQuery,
  CancelCorrectionBody,
  CorrectionParams,
  CreateWorkScheduleBody,
  DecideCorrectionBody,
  DeleteHolidayBody,
  HolidayDateParams,
  HolidayListQuery,
  ListCorrectionsQuery,
  MyAttendanceEventsQuery,
  PutHolidayBody,
  SubmitCorrectionBody,
  VoidAttendanceBody,
} from '@taskflow/contracts';
import { Router, type RequestHandler } from 'express';
import type * as z from 'zod';

import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { validate } from '../../../core/http/validate';
import {
  permitCompany,
  requireIdempotencyKey,
  type AttendanceCompanyMembership,
} from './attendance-access';
import type { AttendanceController } from './attendance.controller';
import type { CorrectionController } from './correction.controller';

export interface AttendanceRouteDeps {
  controller: AttendanceController;
  corrections: CorrectionController;
  membership: AttendanceCompanyMembership;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

/** Gắn dưới `/api/v1` — chấm công thuộc CÔNG TY (company-level ADR-136), không còn `/workspaces/:wsId`. */
export const ATTENDANCE_PATH = '/attendance';

/** Của chính nhân viên (Admin không có — ADR-134). */
const SELF = ['attendance:self'];
const HR = ['hr:manage'];
/** Lịch + ngày lễ: nhân viên và HR (gồm Admin) đọc được (§4). */
const READ_CALENDAR = ['attendance:self', 'hr:manage'];

/**
 * Route chấm công (§4). Mỗi route: 401 → 401 SESSION_REVOKED (không thuộc công ty) → 403 quyền → [hạn mức riêng] →
 * 400 params / query / body / header → use case. Không cache (IP/UA, giờ chấm là dữ liệu cá nhân — §9).
 */
export function attendanceRoutes(d: AttendanceRouteDeps): Router {
  const router = Router();
  const c = d.controller;
  const noStore: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };
  // Gắn THEO TỪNG ROUTE như task / leave (audit T-028 F1).
  const base = [noStore, d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated)];
  const guard = (
    anyOf: readonly string[],
    input: { params?: z.ZodType; body?: z.ZodType; query?: z.ZodType } = {},
    extra: readonly RequestHandler[] = [],
  ) => [...base, permitCompany(d.membership, anyOf), ...extra, validate(input)];
  const punch = d.limit(RATE_LIMIT_RULES.attendancePunch);

  // Của chính nhân viên.
  router.get('/me/today', ...guard(SELF), c.meToday);
  router.get('/me', ...guard(SELF, { query: AttendanceMonthQuery }), c.meMonth);
  router.get('/me/events', ...guard(SELF, { query: MyAttendanceEventsQuery }), c.meEvents);
  router.post('/check-in', ...guard(SELF, {}, [...punch, requireIdempotencyKey]), c.checkIn);
  router.post('/check-out', ...guard(SELF, {}, [...punch, requireIdempotencyKey]), c.checkOut);

  // HR.
  router.get('/today', ...guard(HR), c.companyToday);
  router.get('/', ...guard(HR, { query: AttendanceCompanyMonthQuery }), c.companyMonth);
  router.get(
    '/export.csv',
    ...guard(HR, { query: AttendanceMonthQuery }, d.limit(RATE_LIMIT_RULES.attendanceExport)),
    c.exportCsv,
  );
  router.get('/events', ...guard(HR, { query: AttendanceEventsQuery }), c.listEvents);
  router.post('/events', ...guard(HR, { body: AdjustAttendanceBody }), c.adjust);
  router.post(
    '/events/:eventId/void',
    ...guard(HR, { params: AttendanceEventParams, body: VoidAttendanceBody }),
    c.voidEvent,
  );

  // Đơn bổ sung giờ (hr-extended ADR-129, T-056). Danh sách: `mine=1` ⇒ attendance:self, không ⇒ hr:manage (quyền
  // chọn THEO query trước validate — body/query sai vẫn 403 trước 400).
  const k = d.corrections;
  router.post(
    '/corrections',
    ...guard(SELF, { body: SubmitCorrectionBody }, [
      ...d.limit(RATE_LIMIT_RULES.correctionSubmit),
      requireIdempotencyKey,
    ]),
    k.submit,
  );
  const listPermit: RequestHandler = (req, res, next) =>
    permitCompany(d.membership, (req.query as Record<string, unknown>).mine === '1' ? SELF : HR)(
      req,
      res,
      next,
    );
  router.get(
    '/corrections',
    ...base,
    listPermit,
    validate({ query: ListCorrectionsQuery }),
    k.list,
  );
  const one = { params: CorrectionParams };
  router.post(
    '/corrections/:requestId/cancel',
    ...guard(SELF, { ...one, body: CancelCorrectionBody }),
    k.cancel,
  );
  router.post(
    '/corrections/:requestId/approve',
    ...guard(HR, { ...one, body: DecideCorrectionBody }),
    k.approve,
  );
  router.post(
    '/corrections/:requestId/reject',
    ...guard(HR, { ...one, body: DecideCorrectionBody }),
    k.reject,
  );

  // Lịch + ngày lễ (một bộ cho cả công ty).
  router.get('/schedules', ...guard(READ_CALENDAR), c.listSchedules);
  router.post('/schedules', ...guard(HR, { body: CreateWorkScheduleBody }), c.createSchedule);
  router.get('/holidays', ...guard(READ_CALENDAR, { query: HolidayListQuery }), c.listHolidays);
  router.put(
    '/holidays/:date',
    ...guard(HR, { params: HolidayDateParams, body: PutHolidayBody }),
    c.putHoliday,
  );
  // DELETE thường không có body ⇒ thiếu body = `{}`.
  router.delete(
    '/holidays/:date',
    ...guard(HR, { params: HolidayDateParams, body: DeleteHolidayBody.optional().default({}) }),
    c.deleteHoliday,
  );
  return router;
}
