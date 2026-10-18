import { MyPayslipDto, MyPayslipSummaryDto } from '@taskflow/contracts/payroll';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { MockDb } from './mock-db';
import { requireCompany } from './mock-guard';
import type { MockPayroll, MockPayslip } from './mock-payroll';
import { fail, ok } from './respond';

// "Phiếu lương của tôi" (payroll.md §5.1 / §6): chỉ nhân viên (Admin ⇒ 403); chỉ bảng ĐÃ PHÁT HÀNH; không có ⇒ 404;
// danh sách KHÔNG có số tiền; `no-store`.

const NO_STORE = { 'Cache-Control': 'no-store' };
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

const mine = ({ userRef: _u, lockVersion: _l, ...dto }: MockPayslip) => dto;

export function createPayslipHandlers(
  baseUrl: string,
  payroll: MockPayroll,
  db: MockDb,
): HttpHandler[] {
  const base = `${baseUrl}/payslips`;
  const guard = (request: Request) => {
    return requireCompany(request, db, 'payslip:self');
  };
  const published = (period: string) => {
    const run = payroll.runs.get(period);
    return run?.status === 'PUBLISHED' ? run : undefined;
  };
  const notFound = () =>
    fail(404, 'RESOURCE_NOT_FOUND', { resource: 'payslip' }, { headers: NO_STORE });

  return [
    http.get(base, ({ request }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const rows = [...payroll.runs.values()]
        .filter((r) => r.status === 'PUBLISHED')
        .flatMap((r) => {
          const slip = payroll.current(r, ctx.ok.user.id);
          return slip
            ? [{ period: r.period, revision: slip.revision, publishedAt: r.publishedAt ?? '' }]
            : [];
        })
        .sort((a, b) => b.period.localeCompare(a.period));
      return ok(z.array(MyPayslipSummaryDto), rows, { headers: NO_STORE });
    }),

    http.get(`${base}/:period`, ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const period = String(params.period);
      if (!PERIOD.test(period)) return fail(400, 'VALIDATION_ERROR', { issues: [] });
      const run = published(period);
      const slip = run && payroll.current(run, ctx.ok.user.id);
      return slip ? ok(MyPayslipDto, mine(slip), { headers: NO_STORE }) : notFound();
    }),

    http.get(`${base}/:period/revisions/:revision`, ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const run = published(String(params.period));
      const slip = run?.slips
        .get(ctx.ok.user.id)
        ?.find((s) => s.revision === Number(params.revision));
      return slip ? ok(MyPayslipDto, mine(slip), { headers: NO_STORE }) : notFound();
    }),
  ];
}
