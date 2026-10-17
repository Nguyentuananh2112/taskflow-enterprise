import { DateOnly } from '@taskflow/contracts/common';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import {
  CreateWorkScheduleBody,
  DeleteHolidayBody,
  HolidayDto,
  PutHolidayBody,
  WorkScheduleDto,
} from '@taskflow/contracts/attendance';

import { COMPANY_SCOPE, requireCompany, type CompanyContext } from './mock-guard';
import { ruleFail, type MockHr } from './mock-hr';
import { noContent, ok, parseBody, ruleViolation } from './respond';

// Lịch làm việc & ngày lễ (attendance-leave.md §5, ADR-121; A chốt): đọc — mọi thành viên; ghi —
// `hr:manage`. Lịch chỉ hiệu lực từ hôm nay (422 SCHEDULE_IN_PAST), trùng `effectiveFrom` ⇒ thay.
// Ngày lễ < hôm nay: HR thường 422 HOLIDAY_IN_PAST; Admin thiếu lý do 422 REASON_REQUIRED. DELETE
// idempotent (không có lễ vẫn 204).

const YearQuery = z.coerce.number().int().min(1970).max(9999);

/** Ghi ngày đã qua: chỉ Admin, bắt buộc lý do (ADR-121, A#4 — Mốc 3.5 "OWNER" ⇒ Admin). */
function pastGuard(ctx: CompanyContext, date: string, today: string, reason: string | undefined) {
  if (date >= today) return null;
  if (ctx.company.role !== 'ADMIN') return ruleFail('HOLIDAY_IN_PAST');
  return reason ? null : ruleFail('REASON_REQUIRED');
}

export function createHrCalendarHandlers(baseUrl: string, hr: MockHr): HttpHandler[] {
  const base = `${baseUrl}/attendance`;
  const { db, attendance } = hr;
  // Đọc lịch / ngày lễ: mọi người thuộc công ty; ghi: `hr:manage` (company-level.md §4).
  const member = (request: Request) => requireCompany(request, db);
  const writer = (request: Request) => requireCompany(request, db, 'hr:manage');
  const dateParam = (params: Record<string, unknown>) => DateOnly.safeParse(params.date);

  return [
    http.get(`${base}/schedules`, ({ request }) => {
      const ctx = member(request);
      if (ctx.response) return ctx.response;
      return ok(z.array(WorkScheduleDto), hr.schedules.get(COMPANY_SCOPE) ?? []);
    }),

    http.post(`${base}/schedules`, async ({ request }) => {
      const ctx = writer(request);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, CreateWorkScheduleBody);
      if (body.response) return body.response;
      const b = body.data;
      if (b.effectiveFrom < attendance.today()) return ruleFail('SCHEDULE_IN_PAST');
      const wsId = COMPANY_SCOPE;
      const row: WorkScheduleDto = {
        ...b,
        createdBy: { id: ctx.ok.user.id, fullName: ctx.ok.user.fullName },
        createdAt: attendance.serverNow(),
      };
      const list = (hr.schedules.get(wsId) ?? []).filter(
        (s) => s.effectiveFrom !== b.effectiveFrom,
      );
      hr.schedules.set(
        wsId,
        [...list, row].sort((x, y) => x.effectiveFrom.localeCompare(y.effectiveFrom)),
      );
      return ok(WorkScheduleDto, row, { status: 201 });
    }),

    http.get(`${base}/holidays`, ({ request }) => {
      const ctx = member(request);
      if (ctx.response) return ctx.response;
      const year = YearQuery.safeParse(new URL(request.url).searchParams.get('year'));
      if (!year.success) return ruleViolation('year', 'invalid_type', 'Năm không hợp lệ');
      const list = (hr.holidays.get(COMPANY_SCOPE) ?? []).filter((h) =>
        h.date.startsWith(`${year.data}-`),
      );
      return ok(z.array(HolidayDto), list);
    }),

    http.put(`${base}/holidays/:date`, async ({ request, params }) => {
      const ctx = writer(request);
      if (ctx.response) return ctx.response;
      const date = dateParam(params);
      if (!date.success) return ruleViolation('date', 'invalid_format', 'Ngày không hợp lệ');
      const body = await parseBody(request, PutHolidayBody);
      if (body.response) return body.response;
      const past = pastGuard(ctx.ok, date.data, attendance.today(), body.data.reason);
      if (past) return past;
      const wsId = COMPANY_SCOPE;
      const row = { date: date.data, name: body.data.name };
      const list = (hr.holidays.get(wsId) ?? []).filter((h) => h.date !== row.date);
      hr.holidays.set(
        wsId,
        [...list, row].sort((x, y) => x.date.localeCompare(y.date)),
      );
      return ok(HolidayDto, row);
    }),

    http.delete(`${base}/holidays/:date`, async ({ request, params }) => {
      const ctx = writer(request);
      if (ctx.response) return ctx.response;
      const date = dateParam(params);
      if (!date.success) return ruleViolation('date', 'invalid_format', 'Ngày không hợp lệ');
      const hasBody = request.headers.get('content-type') !== null;
      const body = hasBody ? await parseBody(request, DeleteHolidayBody) : { data: {} };
      if (body.response) return body.response;
      const wsId = COMPANY_SCOPE;
      const list = hr.holidays.get(wsId) ?? [];
      if (!list.some((h) => h.date === date.data)) return noContent();
      const past = pastGuard(ctx.ok, date.data, attendance.today(), body.data.reason);
      if (past) return past;
      hr.holidays.set(
        wsId,
        list.filter((h) => h.date !== date.data),
      );
      return noContent();
    }),
  ];
}
