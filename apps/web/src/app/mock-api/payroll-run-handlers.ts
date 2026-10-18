import {
  PayrollRunDto,
  PayrollRunListDto,
  PublishPayrollBody,
  RecalculatePreviewDto,
} from '@taskflow/contracts/payroll';
import { HttpResponse, http, type HttpHandler } from 'msw';

import type { MockDb } from './mock-db';
import { requireCompany } from './mock-guard';
import type { MockPayroll, MockRun } from './mock-payroll';
import { recalculate, runView } from './mock-payroll-ops';
import { ruleFail } from './mock-hr';
import { fail, ok, parseBody } from './respond';

// Bảng lương tháng (payroll.md §4–§5.2, contract T-048): `payroll:manage` (quyền kiểm TRƯỚC validate); tạo nháp khi
// tháng đã kết thúc (422 PERIOD_NOT_ENDED); phát hành bị chặn ⇒ 422 PUBLISH_BLOCKED + đủ blockers; `no-store`.

const NO_STORE = { 'Cache-Control': 'no-store' };
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const nextPeriod = (p: string) => {
  const [y = 0, m = 1] = p.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

export function createPayrollRunHandlers(
  baseUrl: string,
  payroll: MockPayroll,
  db: MockDb,
  today: () => string,
): HttpHandler[] {
  const base = `${baseUrl}/payroll/runs`;
  const guard = (request: Request) => requireCompany(request, db, 'payroll:manage');
  const badPeriod = () =>
    fail(400, 'VALIDATION_ERROR', {
      issues: [{ path: ['period'], code: 'invalid_format', message: 'YYYY-MM' }],
    });
  const notFound = () => fail(404, 'RESOURCE_NOT_FOUND', { resource: 'payroll_run' });

  const dto = (run: MockRun, actorId: string) => runView(payroll, run, actorId);
  /** Bảng của kỳ hợp lệ, hoặc Response lỗi. */
  const find = (params: Record<string, unknown>) => {
    const period = String(params.period);
    if (!PERIOD.test(period)) return { response: badPeriod() };
    const run = payroll.runs.get(period);
    return run ? { run } : { response: notFound() };
  };

  return [
    http.get(base, ({ request }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const runs = [...payroll.runs.values()]
        .sort((a, b) => b.period.localeCompare(a.period))
        .map((r) => ({
          period: r.period,
          status: r.status,
          payslipCount: r.slips.size,
          netTotal: [...r.slips.values()].reduce((n, l) => n + (l.at(-1)?.netPay ?? 0), 0),
          publishedAt: r.publishedAt,
        }));
      const thisMonth = today().slice(0, 7);
      const last = runs[0]?.period;
      const period = last ? nextPeriod(last) : runs.length === 0 ? prevOf(thisMonth) : thisMonth;
      const next = { period, from: `${nextPeriod(period)}-01`, canCreate: period < thisMonth };
      return ok(PayrollRunListDto, { runs, next }, { headers: NO_STORE });
    }),

    http.post(`${base}/:period`, ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const period = String(params.period);
      if (!PERIOD.test(period)) return badPeriod();
      if (period >= today().slice(0, 7)) return ruleFail('PERIOD_NOT_ENDED');
      return ok(PayrollRunDto, dto(payroll.createRun(period), ctx.ok.user.id), { status: 201 });
    }),

    http.get(`${base}/:period`, ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const hit = find(params);
      if (hit.response) return hit.response;
      return ok(PayrollRunDto, dto(hit.run, ctx.ok.user.id), { headers: NO_STORE });
    }),

    http.post(`${base}/:period/recalculate/preview`, ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const hit = find(params);
      if (hit.response) return hit.response;
      const changedCount = [...hit.run.slips.values()].filter((l) => {
        const s = l.at(-1);
        return s && payroll.paidHalfDays(s.userId, hit.run.period) !== s.paidHalfDays;
      }).length;
      return ok(RecalculatePreviewDto, { changedCount });
    }),

    http.post(`${base}/:period/recalculate`, ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const hit = find(params);
      if (hit.response) return hit.response;
      if (hit.run.status !== 'DRAFT')
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'not_draft' });
      recalculate(payroll, hit.run);
      return ok(PayrollRunDto, dto(hit.run, ctx.ok.user.id));
    }),

    http.post(`${base}/:period/publish`, async ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, PublishPayrollBody);
      if (body.response) return body.response;
      const hit = find(params);
      if (hit.response) return hit.response;
      if (hit.run.status !== 'DRAFT')
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'not_draft' });
      const blockers = [...hit.run.slips.values()].flatMap((l) => {
        const s = l.at(-1);
        const reasons = s ? payroll.blockReasons(hit.run, s) : [];
        return s && reasons.length > 0 ? [{ userId: s.userId, reasons }] : [];
      });
      if (blockers.length > 0) return ruleFail('PUBLISH_BLOCKED', { blockers });
      payroll.publish(hit.run, { id: ctx.ok.user.id, fullName: ctx.ok.user.fullName });
      return ok(PayrollRunDto, dto(hit.run, ctx.ok.user.id));
    }),

    http.get(`${base}/:period/export.xlsx`, ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const hit = find(params);
      if (hit.response) return hit.response;
      return new HttpResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="bang-luong-${hit.run.period}.xlsx"`,
          ...NO_STORE,
        },
      });
    }),
  ];
}

function prevOf(period: string): string {
  const [y = 0, m = 1] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
