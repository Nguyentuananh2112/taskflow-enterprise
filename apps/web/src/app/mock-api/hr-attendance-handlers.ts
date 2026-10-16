import {
  AdjustAttendanceBody,
  AttendanceCompanyTodayDto,
  AttendanceEventChangeDto,
  AttendanceEventsDto,
  AttendanceEventsQuery,
  AttendanceMemberMonthDto,
  AttendanceMonthQuery,
  VoidAttendanceBody,
} from '@taskflow/contracts/attendance';
import { Cursor, limitQuery } from '@taskflow/contracts/common';
import { HttpResponse, http, type HttpHandler } from 'msw';
import * as z from 'zod';

import { MOCK_SCHEDULE, MOCK_TZ } from './mock-attendance';
import { forbiddenUnlessGranted, requireMember, type MemberContext } from './mock-guard';
import {
  CSV_STATUS,
  conflictFail,
  csvCell,
  localToEpoch,
  monthDays,
  totalsOf,
  type MockHr,
} from './mock-hr';
import { fail, ok, paginate, parseBody, parseQuery } from './respond';

// Chấm công phía HR (attendance-leave.md §5, DTO A chốt): mọi route `hr:manage` — kiểm quyền TRƯỚC
// validate query/body (B-M4: thành viên thường gửi sai vẫn 403). Lệnh ghi với chính mình ⇒ 403 trừ
// OWNER (B-H1). `userId` chưa từng có dữ liệu ⇒ 404.

const MonthPageQuery = AttendanceMonthQuery.extend({
  cursor: Cursor.optional(),
  limit: limitQuery(50, 50),
});

/** UTF-8 BOM để Excel đọc đúng tiếng Việt (§5). */
const BOM = String.fromCharCode(0xfeff);

const selfWrite = (ctx: MemberContext, userId: string) =>
  userId === ctx.user.id && ctx.membership.role !== 'OWNER'
    ? fail(403, 'FORBIDDEN_ACCESS', { required: 'hr:manage' })
    : null;

export function createHrAttendanceHandlers(baseUrl: string, hr: MockHr): HttpHandler[] {
  const base = `${baseUrl}/workspaces/:wsId/attendance`;
  const { db, attendance } = hr;
  const guard = (request: Request, params: Record<string, unknown>) => {
    const ctx = requireMember(request, db, { wsId: params.wsId as string });
    if (ctx.response) return ctx;
    const denied = forbiddenUnlessGranted(ctx.ok, db, 'hr:manage');
    return denied ? { response: denied } : ctx;
  };
  const rows = (wsId: string, month: string) => {
    const days = monthDays(month);
    return hr.people(wsId, days[0] ?? month, days.at(-1) ?? month).map(({ user, left }) => {
      const list = days.map((d) => hr.day(wsId, user.id, d));
      return { user, left, days: list, totals: totalsOf(list) };
    });
  };
  const change = (wsId: string, userId: string, date: string, id: string) => {
    const event = attendance.events(wsId, userId, date).find((e) => e.id === id);
    if (!event) throw new Error('mock: lượt vừa ghi không tồn tại');
    return { event, day: hr.day(wsId, userId, date) };
  };

  return [
    http.get(`${base}/today`, ({ request, params }) => {
      const ctx = guard(request, params);
      if (ctx.response) return ctx.response;
      const wsId = String(params.wsId);
      const date = attendance.today();
      const holiday = hr.holidayOn(wsId, date);
      const members = hr
        .people(wsId, date, date)
        .map((p) => ({ ...p, day: hr.day(wsId, p.user.id, date) }));
      const isWorkday =
        members[0]?.day.isWorkday ?? new Date(`${date}T00:00:00Z`).getUTCDay() !== 0;
      return ok(AttendanceCompanyTodayDto, {
        serverNow: attendance.serverNow(),
        date,
        timezone: MOCK_TZ,
        isWorkday,
        isHoliday: holiday !== undefined,
        holidayName: holiday?.name ?? null,
        schedule: isWorkday ? MOCK_SCHEDULE : null,
        members,
      });
    }),

    http.get(`${base}/export.csv`, ({ request, params }) => {
      const ctx = guard(request, params);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, AttendanceMonthQuery);
      if (query.response) return query.response;
      const { month } = query.data;
      const lines = [
        ['Nhân viên', 'Ngày', 'Trạng thái', 'Vào', 'Ra', 'Giờ làm (phút)', 'Muộn (phút)'],
      ];
      const body = rows(String(params.wsId), month).flatMap((r) =>
        r.days.map((d) =>
          [
            csvCell(r.user.fullName),
            csvCell(d.date, false),
            csvCell(CSV_STATUS[d.status]),
            csvCell(d.firstIn ?? '', false),
            csvCell(d.lastOut ?? '', false),
            csvCell(d.workedMin, false),
            csvCell(d.lateMin, false),
          ].join(','),
        ),
      );
      const csv = `${BOM}${[lines[0]?.map((h) => csvCell(h)).join(','), ...body].join('\r\n')}\r\n`;
      return new HttpResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="cham-cong-${month}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }),

    http.get(`${base}/events`, ({ request, params }) => {
      const ctx = guard(request, params);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, AttendanceEventsQuery);
      if (query.response) return query.response;
      const wsId = String(params.wsId);
      if (!hr.known(wsId, query.data.userId))
        return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
      return ok(AttendanceEventsDto, {
        timezone: MOCK_TZ,
        events: attendance.events(wsId, query.data.userId, query.data.date),
      });
    }),

    http.post(`${base}/events`, async ({ request, params }) => {
      const ctx = guard(request, params);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, AdjustAttendanceBody);
      if (body.response) return body.response;
      const b = body.data;
      const wsId = String(params.wsId);
      const denied = selfWrite(ctx.ok, b.userId);
      if (denied) return denied;
      if (!hr.known(wsId, b.userId)) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
      const by = { id: ctx.ok.user.id, fullName: ctx.ok.user.fullName };
      const at = localToEpoch(b.date, b.time, b.nextDay);
      const id = attendance.adjust(wsId, b.userId, b.date, {
        kind: b.kind,
        at,
        by,
        note: b.reason,
      });
      return ok(AttendanceEventChangeDto, change(wsId, b.userId, b.date, id), { status: 201 });
    }),

    http.post(`${base}/events/:id/void`, async ({ request, params }) => {
      const ctx = guard(request, params);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, VoidAttendanceBody);
      if (body.response) return body.response;
      const wsId = String(params.wsId);
      const hit = hr.locate(wsId, String(params.id));
      if (!hit) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'attendance_event' });
      const denied = selfWrite(ctx.ok, hit.userId);
      if (denied) return denied;
      if (hit.punch.voided) return conflictFail('already_voided');
      const by = { id: ctx.ok.user.id, fullName: ctx.ok.user.fullName };
      attendance.voidPunch(wsId, hit.userId, hit.date, hit.punch.id, by, body.data.reason);
      return ok(AttendanceEventChangeDto, change(wsId, hit.userId, hit.date, hit.punch.id));
    }),

    // Đặt SAU các route con: `${base}` không khớp `/today` nhưng giữ thứ tự cho dễ đọc.
    http.get(base, ({ request, params }) => {
      const ctx = guard(request, params);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, MonthPageQuery);
      if (query.response) return query.response;
      const page = paginate(
        rows(String(params.wsId), query.data.month),
        query.data.cursor,
        query.data.limit,
      );
      return ok(z.array(AttendanceMemberMonthDto), page.data, { page: page.page });
    }),
  ];
}
