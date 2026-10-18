import {
  CreatePayslipRevisionBody,
  CreateSalaryProfileVersionBody,
  PayrollRunDto,
  PayrollSettingsDto,
  PayslipDto,
  PutPayrollSettingsBody,
  PutPayslipBody,
  SalaryProfileDto,
  SalaryProfileVersionDto,
} from '@taskflow/contracts/payroll';
import { Uuid } from '@taskflow/contracts/common';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { MockDb } from './mock-db';
import { requireCompany } from './mock-guard';
import type { MockPayroll, MockPayslip } from './mock-payroll';
import { addMissing, runView } from './mock-payroll-ops';
import { fail, ok, parseBody } from './respond';

// Cài đặt, hồ sơ lương, phiếu 1 người (payroll.md §5.2, contract T-048). Luật self TUYỆT ĐỐI (ADR-124): hồ sơ lương /
// phiếu / bản điều chỉnh của chính người gọi ⇒ 403 (kể cả Admin — Admin không có phiếu). NHÁP: PUT; ĐÃ PHÁT HÀNH: bản
// điều chỉnh có lý do.

const NO_STORE = { 'Cache-Control': 'no-store' };
const strip = ({ userRef: _u, ...dto }: MockPayslip) => dto;

export function createPayrollEditHandlers(
  baseUrl: string,
  payroll: MockPayroll,
  db: MockDb,
): HttpHandler[] {
  const base = `${baseUrl}/payroll`;
  const guard = (request: Request) => requireCompany(request, db, 'payroll:manage');
  const self = () => fail(403, 'FORBIDDEN_ACCESS', { required: 'payroll:manage' });
  const iso = () => new Date(db.now()).toISOString();
  const slipOf = (params: Record<string, unknown>) => {
    const run = payroll.runs.get(String(params.period));
    const id = Uuid.safeParse(params.userId);
    const slip = run && id.success ? payroll.current(run, id.data) : undefined;
    return run && slip ? { run, slip } : null;
  };
  const notFound = () => fail(404, 'RESOURCE_NOT_FOUND', { resource: 'payslip' });

  return [
    http.get(`${base}/settings`, ({ request }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      return ok(PayrollSettingsDto, payroll.settings);
    }),
    http.put(`${base}/settings`, async ({ request }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, PutPayrollSettingsBody);
      if (body.response) return body.response;
      if (body.data.expectedVersion !== payroll.settings.version)
        return fail(409, 'VERSION_CONFLICT');
      payroll.settings = {
        seniorityPerYear: body.data.seniorityPerYear,
        version: payroll.settings.version + 1,
        updatedAt: iso(),
        updatedBy: { id: ctx.ok.user.id, fullName: ctx.ok.user.fullName },
      };
      return ok(PayrollSettingsDto, payroll.settings);
    }),

    http.get(`${base}/salary-profiles`, ({ request }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const period = new Date(db.now()).toISOString().slice(0, 7);
      const rows = payroll.people().map((u) => ({
        userId: u.id,
        user: u,
        hireDate: payroll.hireDateOf(u.id),
        current: payroll.profileFor(u.id, period) ?? null,
        versions: [...(payroll.profiles.get(u.id) ?? [])].sort((a, b) =>
          b.effectiveFrom.localeCompare(a.effectiveFrom),
        ),
      }));
      return ok(z.array(SalaryProfileDto), rows, { headers: NO_STORE });
    }),
    http.post(`${base}/salary-profiles/:userId`, async ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      if (params.userId === ctx.ok.user.id) return self();
      const body = await parseBody(request, CreateSalaryProfileVersionBody);
      if (body.response) return body.response;
      const userId = String(params.userId);
      const list = payroll.profiles.get(userId) ?? [];
      if (list.some((v) => v.effectiveFrom === body.data.effectiveFrom))
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'duplicate_effective_from' });
      const version = {
        id: crypto.randomUUID(),
        ...body.data,
        createdBy: { id: ctx.ok.user.id, fullName: ctx.ok.user.fullName },
        createdAt: iso(),
      };
      payroll.profiles.set(userId, [...list, version]);
      return ok(SalaryProfileVersionDto, version, { status: 201 });
    }),

    http.post(`${base}/runs/:period/add-missing`, ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const run = payroll.runs.get(String(params.period));
      if (!run) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'payroll_run' });
      addMissing(payroll, run);
      return ok(PayrollRunDto, runView(payroll, run, ctx.ok.user.id));
    }),

    http.get(`${base}/runs/:period/payslips/:userId`, ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const hit = slipOf(params);
      return hit ? ok(PayslipDto, strip(hit.slip), { headers: NO_STORE }) : notFound();
    }),
    http.put(`${base}/runs/:period/payslips/:userId`, async ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      if (params.userId === ctx.ok.user.id) return self();
      const body = await parseBody(request, PutPayslipBody);
      if (body.response) return body.response;
      const hit = slipOf(params);
      if (!hit) return notFound();
      if (hit.run.status !== 'DRAFT')
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'not_draft' });
      if (hit.slip.lockVersion !== body.data.expectedLockVersion)
        return fail(409, 'VERSION_CONFLICT');
      const { expectedLockVersion: _v, ...edit } = body.data;
      const next = payroll.build(hit.run, hit.slip.userRef, {
        ...edit,
        lockVersion: hit.slip.lockVersion + 1,
      });
      hit.run.slips.set(hit.slip.userId, [next]);
      return ok(PayslipDto, strip(next));
    }),
    http.post(`${base}/runs/:period/payslips/:userId/revisions`, async ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      if (params.userId === ctx.ok.user.id) return self();
      const body = await parseBody(request, CreatePayslipRevisionBody);
      if (body.response) return body.response;
      const hit = slipOf(params);
      if (!hit) return notFound();
      if (hit.run.status !== 'PUBLISHED')
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'not_published' });
      if (hit.slip.revision !== body.data.expectedRevision) return fail(409, 'VERSION_CONFLICT');
      const { expectedRevision: _r, reason, ...edit } = body.data;
      // Bản điều chỉnh copy công của bản trước (không tính lại — ADR-127).
      const next = payroll.build(hit.run, hit.slip.userRef, {
        ...edit,
        paidHalfDays: hit.slip.paidHalfDays,
      });
      return ok(PayslipDto, strip(payroll.revise(hit.run, hit.slip.userRef, next, reason)), {
        status: 201,
      });
    }),
  ];
}
