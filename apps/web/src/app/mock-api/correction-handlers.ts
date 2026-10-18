import {
  CancelCorrectionBody,
  CorrectionApprovedDto,
  CorrectionDto,
  DecideCorrectionBody,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
  ListCorrectionsQuery,
  SubmitCorrectionBody,
} from '@taskflow/contracts/attendance';
import { Uuid } from '@taskflow/contracts/common';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import { MockCorrections } from './mock-corrections';
import { COMPANY_SCOPE, requireCompany } from './mock-guard';
import { conflictFail, monthDays, ruleFail, totalsOf, type MockHr } from './mock-hr';
import { fail, ok, paginate, parseBody, parseQuery } from './respond';

// Đơn bổ sung giờ (ADR-129, hr-extended §4 — contract T-056). `mine=1` ⇒ `attendance:self`; không `mine` ⇒ `hr:manage`
// (quyền kiểm TRƯỚC validate). Đơn người khác ⇒ 404; HR tự duyệt đơn của mình ⇒ 403 (tuyệt đối, kể cả Admin — Admin
// không có đơn). Lý do chỉ người gửi + HR thấy.

export function createCorrectionHandlers(baseUrl: string, hr: MockHr): HttpHandler[] {
  const base = `${baseUrl}/attendance/corrections`;
  const { db } = hr;
  const store = new MockCorrections(hr);
  const notFound = () => fail(404, 'RESOURCE_NOT_FOUND', { resource: 'correction_request' });
  const find = (id: unknown) => {
    const parsed = Uuid.safeParse(id);
    return parsed.success ? store.rows.find((r) => r.id === parsed.data) : undefined;
  };

  /** Duyệt / từ chối (`hr:manage`, khác người gửi). */
  const decide = (kind: 'approve' | 'reject') =>
    http.post(`${base}/:id/${kind}`, async ({ request, params }) => {
      const ctx = requireCompany(request, db, 'hr:manage');
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, DecideCorrectionBody);
      if (body.response) return body.response;
      const row = find(params.id);
      if (!row) return notFound();
      if (row.userId === ctx.ok.user.id)
        return fail(403, 'FORBIDDEN_ACCESS', { required: 'hr:manage' });
      if (row.status !== 'PENDING') return conflictFail('invalid_transition');
      if (row.version !== body.data.expectedVersion) return fail(409, 'VERSION_CONFLICT');
      const by = { id: ctx.ok.user.id, fullName: ctx.ok.user.fullName };
      const note = body.data.note ?? null;
      if (kind === 'reject') {
        store.decide(row, 'REJECTED', by, note);
        return ok(CorrectionDto, store.dto(row, true));
      }
      if (db.company.row(row.userId)?.role !== 'EMPLOYEE')
        return ruleFail('REQUESTER_NOT_EMPLOYEE');
      const broken = store.rule(row.userId, row);
      if (broken) return ruleFail(broken);
      const eventId = store.approve(row, by, note);
      const event = hr.attendance
        .events(COMPANY_SCOPE, row.userId, row.date)
        .find((e) => e.id === eventId);
      if (!event) throw new Error('mock: lượt vừa ghi không tồn tại');
      const month = monthDays(row.date.slice(0, 7)).map((d) =>
        hr.day(COMPANY_SCOPE, row.userId, d),
      );
      return ok(CorrectionApprovedDto, {
        request: store.dto(row, true),
        event,
        day: hr.day(COMPANY_SCOPE, row.userId, row.date),
        totals: totalsOf(month, hr.attendance.today()),
      });
    });

  return [
    http.post(base, async ({ request }) => {
      const ctx = requireCompany(request, db, 'attendance:self');
      if (ctx.response) return ctx.response;
      const key = IdempotencyKey.safeParse(request.headers.get(IDEMPOTENCY_KEY_HEADER));
      if (!key.success) return fail(400, 'VALIDATION_ERROR', { issues: [] });
      const body = await parseBody(request, SubmitCorrectionBody);
      if (body.response) return body.response;
      const me = ctx.ok.user.id;
      const replay = store.rows.find((r) => r.userId === me && r.key === key.data);
      if (replay) return ok(CorrectionDto, store.dto(replay, true));
      const broken = store.rule(me, body.data);
      if (broken) return ruleFail(broken);
      if (store.pending(me, body.data.date, body.data.kind))
        return conflictFail('correction_pending_exists');
      const row = store.add({ id: me, fullName: ctx.ok.user.fullName }, body.data, key.data);
      return ok(CorrectionDto, store.dto(row, true), { status: 201 });
    }),

    http.get(base, ({ request }) => {
      const mine = new URL(request.url).searchParams.get('mine') === '1';
      const ctx = requireCompany(request, db, mine ? 'attendance:self' : 'hr:manage');
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, ListCorrectionsQuery);
      if (query.response) return query.response;
      const { status, cursor, limit } = query.data;
      const rows = store.rows.filter(
        (r) => (!mine || r.userId === ctx.ok.user.id) && (!status || r.status === status),
      );
      const page = paginate(rows, cursor, limit);
      return ok(
        z.array(CorrectionDto),
        page.data.map((r) => store.dto(r, true)),
        { page: page.page },
      );
    }),

    http.post(`${base}/:id/cancel`, async ({ request, params }) => {
      const ctx = requireCompany(request, db, 'attendance:self');
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, CancelCorrectionBody);
      if (body.response) return body.response;
      const row = find(params.id);
      if (!row || row.userId !== ctx.ok.user.id) return notFound();
      if (row.status !== 'PENDING') return conflictFail('invalid_transition');
      if (row.version !== body.data.expectedVersion) return fail(409, 'VERSION_CONFLICT');
      store.decide(row, 'CANCELLED', null, null);
      return ok(CorrectionDto, store.dto(row, true));
    }),

    decide('approve'),
    decide('reject'),
  ];
}
