import {
  AttendanceExportXlsxQuery,
  XLSX_CONTENT_TYPE,
  attendanceExportFileName,
} from '@taskflow/contracts/attendance';
import {
  LeaveExportQuery,
  LeavePolicyDto,
  LeavePolicyParams,
  LeavePolicyQuery,
  PutLeavePolicyBody,
  PutLeavePolicyResponse,
} from '@taskflow/contracts/leave';
import { HttpResponse, http, type HttpHandler } from 'msw';

import { COMPANY_SCOPE, requireCompany } from './mock-guard';
import { ruleFail, type MockHr } from './mock-hr';
import { fail, ok, parseBody, parseQuery } from './respond';

// Chính sách phép (ADR-131, contract D T-057) + 2 file Excel (ADR-130, contract A T-056 / D T-057) — `hr:manage`, quyền
// kiểm TRƯỚC validate. File mock là vài byte giả có đúng header (web chỉ tải, không đọc nội dung).

const xlsx = (filename: string) =>
  new HttpResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
    status: 200,
    headers: {
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });

export function createPolicyHandlers(baseUrl: string, hr: MockHr): HttpHandler[] {
  const { db, leave, attendance } = hr;
  const guard = (request: Request) => requireCompany(request, db, 'hr:manage');

  return [
    http.get(`${baseUrl}/leave/policy`, ({ request }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, LeavePolicyQuery);
      if (query.response) return query.response;
      return ok(LeavePolicyDto, leave.policies.dto(query.data.year));
    }),

    http.put(`${baseUrl}/leave/policy/:year`, async ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, PutLeavePolicyBody);
      if (body.response) return body.response;
      const year = LeavePolicyParams.safeParse(params);
      if (!year.success) return fail(400, 'VALIDATION_ERROR', { issues: [] });
      const y = year.data.year;
      if (!leave.policies.editable(y)) return ruleFail('POLICY_YEAR_LOCKED');
      const { expectedVersion, reason: _reason, ...fields } = body.data;
      if (leave.policies.dto(y).version !== expectedVersion) return fail(409, 'VERSION_CONFLICT');
      const by = { id: ctx.ok.user.id, fullName: ctx.ok.user.fullName };
      leave.policies.set(y, fields, by, new Date(db.now()).toISOString());
      const negativeBalances = db.company
        .members()
        .filter(([, row]) => row.role === 'EMPLOYEE')
        .flatMap(([id]) => {
          const user = db.getUser(id);
          const remainingDays = leave.balance(COMPANY_SCOPE, id, y).remainingDays;
          return user && remainingDays < 0
            ? [{ userId: id, user: { id, fullName: user.fullName }, remainingDays }]
            : [];
        });
      return ok(PutLeavePolicyResponse, { policy: leave.policies.dto(y), negativeBalances });
    }),

    http.get(`${baseUrl}/leave/export.xlsx`, ({ request }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, LeaveExportQuery);
      if (query.response) return query.response;
      return xlsx(`nghi-phep-${String(query.data.year)}.xlsx`);
    }),

    http.get(`${baseUrl}/attendance/export.xlsx`, ({ request }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, AttendanceExportXlsxQuery);
      if (query.response) return query.response;
      if (query.data.month > attendance.today().slice(0, 7)) return ruleFail('PERIOD_NOT_STARTED');
      return xlsx(attendanceExportFileName(query.data.month));
    }),
  ];
}
