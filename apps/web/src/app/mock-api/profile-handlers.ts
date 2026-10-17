import { Uuid } from '@taskflow/contracts/common';
import { http, type HttpHandler } from 'msw';

import {
  EmployeeProfileDto,
  ProfileSuggestionsDto,
  PutEmployeeProfileBody,
  PutEmployeeProfileResponse,
} from '@taskflow/contracts/company';

import type { MockHr } from './mock-hr';
import { toEmployee } from './employee-view';
import { requireCompany } from './mock-guard';
import { fail, ok, parseBody } from './respond';

// Hồ sơ nhân viên (ADR-128, hr-extended.md §4 — T-054). `me` và `departments` khai báo TRƯỚC `:userId`
// (B-MEDIUM-2). Luật self tuyệt đối: HR sửa hồ sơ chính mình ⇒ 403. Chưa từng là nhân viên ⇒ 404 `user`.

export function createProfileHandlers(baseUrl: string, hr: MockHr): HttpHandler[] {
  const base = `${baseUrl}/hr/employee-profiles`;
  const { db, attendance } = hr;
  const company = db.company;
  const today = () => attendance.today();
  /** Từng có nhiệm kỳ EMPLOYEE (đang làm, chờ kích hoạt, sắp nghỉ, đã nghỉ) — Admin ⇒ undefined. */
  const employee = (id: string) => toEmployee(db, id, today());
  const dto = (id: string) => {
    const e = employee(id);
    return e && company.profiles.dto(e, today());
  };

  return [
    http.get(`${base}/me`, ({ request }) => {
      const ctx = requireCompany(request, db, 'profile:self');
      if (ctx.response) return ctx.response;
      const me = dto(ctx.ok.user.id);
      return me
        ? ok(EmployeeProfileDto, me)
        : fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
    }),

    http.get(`${base}/departments`, ({ request }) => {
      const ctx = requireCompany(request, db, 'hr:manage');
      if (ctx.response) return ctx.response;
      return ok(ProfileSuggestionsDto, company.profiles.suggestions());
    }),

    http.get(`${base}/:userId`, ({ request, params }) => {
      const ctx = requireCompany(request, db, 'hr:manage');
      if (ctx.response) return ctx.response;
      const id = Uuid.safeParse(params.userId);
      const found = id.success ? dto(id.data) : undefined;
      if (!found) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
      return ok(EmployeeProfileDto, found);
    }),

    http.put(`${base}/:userId`, async ({ request, params }) => {
      const ctx = requireCompany(request, db, 'hr:manage');
      if (ctx.response) return ctx.response;
      // Thứ tự lỗi (B, T-054): 401 → 403 sửa chính mình → 400 → 404 → 422 ngày tương lai → 409 → 422 lý do.
      if (params.userId === ctx.ok.user.id)
        return fail(403, 'FORBIDDEN_ACCESS', { required: 'hr:manage' });
      const body = await parseBody(request, PutEmployeeProfileBody);
      if (body.response) return body.response;
      const id = Uuid.safeParse(params.userId);
      if (!id.success || !employee(id.data))
        return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
      const { expectedVersion, reason, ...fields } = body.data;
      if (fields.hireDate && fields.hireDate > today())
        return fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'HIRE_DATE_IN_FUTURE' });
      const current = company.profiles.get(id.data);
      if (current.version !== expectedVersion) return fail(409, 'VERSION_CONFLICT');
      const changesHireDate =
        current.hireDate !== null &&
        fields.hireDate !== undefined &&
        fields.hireDate !== current.hireDate;
      if (changesHireDate && !reason)
        return fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'REASON_REQUIRED' });
      company.profiles.set(id.data, fields);
      const profile = dto(id.data);
      if (!profile) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
      return ok(PutEmployeeProfileResponse, { profile, negativeBalances: [], warnings: [] });
    }),
  ];
}
