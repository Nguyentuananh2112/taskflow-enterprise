import { Uuid } from '@taskflow/contracts/common';
import {
  EmployeeDto,
  HireEmployeeBody,
  HireEmployeeResponse,
  ListEmployeesQuery,
  OffboardingResponse,
  ReissueActivationResponse,
  ScheduleOffboardingBody,
  type EmployeeStatus,
} from '@taskflow/contracts/company';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { MockHr } from './mock-hr';
import { soleOwnerWorkspacesOf, toEmployee } from './employee-view';
import { requireCompany } from './mock-guard';
import { fail, ok, paginate, parseBody, parseQuery } from './respond';

// Nhân viên (ADR-137, company-level.md §4 — `hr:manage`): danh sách theo trạng thái, thêm / nhận lại (token MỘT lần
// trong response, no-store), tạo lại link, lên / hủy lịch nghỉ việc. Mock RÚT GỌN: hoàn tất nghỉ việc ngay khi ngày
// làm cuối đã qua (thay cho job mỗi phút); không dọn đơn nghỉ.

const DAY = 86_400_000;
const EMPLOYEE_TTL = 7 * DAY;
const STATUS_OF_QUERY = {
  active: 'ACTIVE',
  pending: 'PENDING_ACTIVATION',
  offboarding: 'OFFBOARDING',
  left: 'LEFT',
} as const satisfies Record<string, EmployeeStatus>;
const NO_STORE = { 'Cache-Control': 'no-store' };

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const rule = (r: string) => fail(422, 'BUSINESS_RULE_VIOLATION', { rule: r });

export function createEmployeeHandlers(baseUrl: string, hr: MockHr): HttpHandler[] {
  const base = `${baseUrl}/hr/employees`;
  const { db, attendance } = hr;
  const company = db.company;
  const today = () => attendance.today();
  const linkOf = (request: Request, token: string) =>
    `${request.headers.get('origin') ?? 'http://localhost:3000'}/activate#t=${token}`;

  const employee = (userId: string, withAdmin = false) => toEmployee(db, userId, withAdmin);
  const all = () =>
    [...new Set([...company.members().map(([id]) => id), ...company.departures.keys()])]
      .flatMap((id) => employee(id) ?? [])
      .sort(
        (a, b) => a.fullName.localeCompare(b.fullName, 'vi') || a.userId.localeCompare(b.userId),
      );

  /**
   * `access_until` (06:00 ngày sau ngày làm cuối, giờ lịch +07:00 — ADR-137) đã qua ⇒ hoàn tất ngay, như server làm
   * trong request (thay cho job mỗi phút).
   */
  const settle = () => {
    for (const [id, row] of company.members()) {
      const until =
        row.offboardLastDay && Date.parse(`${shift(row.offboardLastDay, 1)}T06:00:00+07:00`);
      if (until && until <= db.now()) company.remove(id);
    }
  };

  return [
    http.get(base, ({ request }) => {
      const ctx = requireCompany(request, db, 'hr:manage');
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, ListEmployeesQuery);
      if (query.response) return query.response;
      settle();
      const { status, q, cursor, limit } = query.data;
      const needle = q?.toLowerCase();
      const rows = all().filter(
        (e) =>
          (status ? e.status === STATUS_OF_QUERY[status] : e.status !== 'LEFT') &&
          (!needle || `${e.fullName} ${e.email}`.toLowerCase().includes(needle)),
      );
      const page = paginate(rows, cursor, limit);
      return ok(z.array(EmployeeDto), page.data, { page: page.page });
    }),

    http.post(base, async ({ request }) => {
      const ctx = requireCompany(request, db, 'hr:manage');
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, HireEmployeeBody);
      if (body.response) return body.response;
      const { email, fullName } = body.data;
      const startDate = body.data.startDate ?? today();
      if (startDate > today() || startDate < shift(today(), -31))
        return rule('START_DATE_OUT_OF_RANGE');
      const existing = db.findUserByEmail(email);
      if (existing && company.row(existing.id)) {
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'already_employee' });
      }
      const user =
        existing ?? db.createUser({ email, fullName, password: '', workspace: false }).user;
      // Nhận lại: nhiệm kỳ mới; có mật khẩu cũ ⇒ đăng nhập luôn, không link.
      company.add(user.id, `${startDate}T00:00:00+07:00`, startDate);
      const needsLink = user.password === '';
      const issued = needsLink ? company.issueToken(user.id, db.now(), EMPLOYEE_TTL) : null;
      return ok(
        HireEmployeeResponse,
        {
          employee: {
            userId: user.id,
            status: needsLink ? 'PENDING_ACTIVATION' : 'ACTIVE',
            version: 1,
            startDate,
          },
          accountCreated: !existing,
          activation: issued && {
            token: issued.token,
            link: linkOf(request, issued.token),
            expiresAt: new Date(issued.expiresAt).toISOString(),
          },
        },
        { status: 201, headers: NO_STORE },
      );
    }),

    http.post(`${base}/:userId/activation-link`, ({ request, params }) => {
      const ctx = requireCompany(request, db, 'hr:manage');
      if (ctx.response) return ctx.response;
      const id = Uuid.safeParse(params.userId);
      const e = id.success ? employee(id.data) : undefined;
      if (!e) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
      if (e.status !== 'PENDING_ACTIVATION') return rule('ALREADY_ACTIVATED');
      const issued = company.issueToken(e.userId, db.now(), EMPLOYEE_TTL);
      return ok(
        ReissueActivationResponse,
        {
          activation: {
            token: issued.token,
            link: linkOf(request, issued.token),
            expiresAt: new Date(issued.expiresAt).toISOString(),
          },
        },
        { headers: NO_STORE },
      );
    }),

    http.put(`${base}/:userId/offboarding`, async ({ request, params }) => {
      const ctx = requireCompany(request, db, 'hr:manage');
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, ScheduleOffboardingBody);
      if (body.response) return body.response;
      const id = Uuid.safeParse(params.userId);
      const e = id.success ? employee(id.data, true) : undefined;
      if (!e || e.status === 'LEFT') return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
      const targetAdmin = company.row(e.userId)?.role === 'ADMIN';
      // HR không tác động chính mình / Admin / người giữ grant (Admin làm được — ADR-137, B T-062).
      if (
        ctx.ok.company.role !== 'ADMIN' &&
        (e.userId === ctx.ok.user.id || e.grants.length > 0 || targetAdmin)
      ) {
        return fail(403, 'FORBIDDEN_ACCESS', { required: 'company:admin' });
      }
      const admins = company.members().filter(([, r]) => r.role === 'ADMIN').length;
      if (targetAdmin && admins <= 1)
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'last_admin' });
      const { lastDay } = body.data;
      // Ngoài [hôm nay − 31, + 90] HOẶC trước ngày vào làm ⇒ cùng một luật (B T-062).
      if (
        lastDay < shift(today(), -31) ||
        lastDay > shift(today(), 90) ||
        (e.startDate !== null && lastDay < e.startDate)
      )
        return rule('LAST_DAY_OUT_OF_RANGE');
      company.setOffboarding(e.userId, lastDay);
      const soleOwnerWorkspaces = soleOwnerWorkspacesOf(db, e.userId);
      const pendingLeaveCount = hr.leave.items.filter(
        (l) => l.userId === e.userId && l.status === 'PENDING',
      ).length;
      settle();
      return ok(OffboardingResponse, {
        employee: employee(e.userId, true) ?? e,
        warnings: { pendingLeaveCount, soleOwnerWorkspaces },
      });
    }),

    http.delete(`${base}/:userId/offboarding`, ({ request, params }) => {
      const ctx = requireCompany(request, db, 'hr:manage');
      if (ctx.response) return ctx.response;
      const id = Uuid.safeParse(params.userId);
      const e = id.success ? employee(id.data) : undefined;
      if (!e || e.status !== 'OFFBOARDING')
        return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
      company.setOffboarding(e.userId, null);
      const after = employee(e.userId);
      return after ? ok(EmployeeDto, after) : fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
    }),
  ];
}
