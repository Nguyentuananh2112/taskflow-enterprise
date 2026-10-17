import { Uuid } from '@taskflow/contracts/common';
import type { NotificationType } from '@taskflow/contracts/hr';
import {
  AdjustLeaveBalanceBody,
  DecideLeaveBody,
  LeaveBalanceRowDto,
  LeaveRequestDto,
  ListLeaveBalancesQuery,
  ListLeaveRequestsQuery,
  RevokeLeaveBody,
} from '@taskflow/contracts/leave';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import { COMPANY_SCOPE, requireCompany, type CompanyContext } from './mock-guard';
import { conflictFail, ruleFail, type MockHr } from './mock-hr';
import type { MockNotifications } from './notification-handlers';
import { fail, ok, paginate, parseBody, parseQuery } from './respond';
import { strip, type Leave } from './mock-leave';

// Nghỉ phép phía HR (attendance-leave.md §9 bảng chuyển trạng thái; D chốt): `hr:manage` kiểm TRƯỚC
// validate (B-M4). Tự xử lý đơn / số dư của mình ⇒ 403 trừ OWNER; OWNER tự làm mà thiếu ghi chú ⇒ 422
// REASON_REQUIRED (B-H1). expectedVersion cũ ⇒ 409 VERSION_CONFLICT; sai trạng thái ⇒ 409 invalid_transition.
// Đăng ký TRƯỚC leave-handlers của E: `GET leave-requests?mine=1` trả `undefined` ⇒ MSW chuyển tiếp.

type Action = 'approve' | 'reject' | 'revoke';
const NEXT = { approve: 'APPROVED', reject: 'REJECTED', revoke: 'REVOKED' } as const;
const NOTIFY: Record<Action, NotificationType> = {
  approve: 'LEAVE_APPROVED',
  reject: 'LEAVE_REJECTED',
  revoke: 'LEAVE_REVOKED',
};

export function createHrLeaveHandlers(
  baseUrl: string,
  hr: MockHr,
  notifications: MockNotifications,
): HttpHandler[] {
  const base = `${baseUrl}/leave`;
  const { db, leave } = hr;
  const guard = (request: Request) => requireCompany(request, db, 'hr:manage');
  const self = (ctx: CompanyContext, userId: string, note: string | null | undefined) => {
    if (userId !== ctx.user.id) return null;
    if (ctx.company.role !== 'ADMIN')
      return fail(403, 'FORBIDDEN_ACCESS', { required: 'hr:manage' });
    return note?.trim() ? null : ruleFail('REASON_REQUIRED');
  };
  const rowOf = (wsId: string, userId: string, year: number) => ({
    userId,
    user: { id: userId, fullName: db.getUser(userId)?.fullName ?? 'Người dùng đã xóa' },
    ...leave.balance(wsId, userId, year),
  });

  const decide = (action: Action) =>
    http.post(`${base}/requests/:id/${action}`, async ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const body = await parseBody(
        request,
        action === 'revoke' ? RevokeLeaveBody : DecideLeaveBody,
      );
      if (body.response) return body.response;
      const wsId = COMPANY_SCOPE;
      const l = Uuid.safeParse(params.id).success
        ? leave.items.find((x) => x.id === params.id && x.workspaceId === wsId)
        : undefined;
      if (!l) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'leave_request' });
      const note = body.data.note ?? null;
      const denied = self(ctx.ok, l.userId, note);
      if (denied) return denied;
      if (l.version !== body.data.expectedVersion)
        return fail(409, 'VERSION_CONFLICT', { currentVersion: l.version, current: strip(l) });
      const valid =
        action === 'revoke'
          ? l.status === 'APPROVED' && l.startDate > leave.today()
          : l.status === 'PENDING';
      if (!valid) return conflictFail('invalid_transition');
      const requester = db.membershipIn(l.userId, wsId);
      if (action === 'approve' && (!requester || requester.role === 'VIEWER'))
        return conflictFail('requester_not_member');
      if (action === 'approve' && l.type === 'ANNUAL') {
        const bal = leave.balance(wsId, l.userId, Number(l.startDate.slice(0, 4)));
        if (bal.remainingDays < l.days) return ruleFail('INSUFFICIENT_BALANCE');
      }
      const by = { id: ctx.ok.user.id, fullName: ctx.ok.user.fullName };
      Object.assign(l, {
        status: NEXT[action],
        decidedBy: by,
        decidedAt: hr.attendance.serverNow(),
        decisionNote: note,
        version: l.version + 1,
        updatedAt: hr.attendance.serverNow(),
      } satisfies Partial<Leave>);
      notifications.notify(l.userId, {
        type: NOTIFY[action],
        refId: l.id,
        workspaceId: wsId,
        workspaceName: requester?.workspaceName ?? '',
        actor: by,
        leave: { type: l.type, startDate: l.startDate, endDate: l.endDate },
      });
      return ok(LeaveRequestDto, strip(l));
    });

  return [
    http.get(`${base}/requests`, ({ request }) => {
      if (new URL(request.url).searchParams.has('mine')) return undefined; // ⇒ leave-handlers (E)
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, ListLeaveRequestsQuery);
      if (query.response) return query.response;
      const { status, cursor, limit } = query.data;
      const all = leave.items
        .filter((l) => l.workspaceId === COMPANY_SCOPE && (!status || l.status === status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const page = paginate(all.map(strip), cursor, limit);
      return ok(z.array(LeaveRequestDto), page.data, { page: page.page });
    }),
    decide('approve'),
    decide('reject'),
    decide('revoke'),

    http.get(`${base}/balances`, ({ request }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, ListLeaveBalancesQuery);
      if (query.response) return query.response;
      const wsId = COMPANY_SCOPE;
      const rows = db
        .membersOf(wsId)
        .filter((m) => m.membership.role !== 'VIEWER')
        .map((m) => rowOf(wsId, m.user.id, query.data.year))
        .sort(
          (a, b) =>
            a.user.fullName.localeCompare(b.user.fullName, 'vi') ||
            a.userId.localeCompare(b.userId),
        );
      const page = paginate(rows, query.data.cursor, query.data.limit);
      return ok(z.array(LeaveBalanceRowDto), page.data, { page: page.page });
    }),

    http.patch(`${base}/balances/:userId/:year`, async ({ request, params }) => {
      const ctx = guard(request);
      if (ctx.response) return ctx.response;
      const userId = Uuid.safeParse(params.userId);
      const year = ListLeaveBalancesQuery.shape.year.safeParse(params.year);
      if (!userId.success || !year.success)
        return fail(400, 'VALIDATION_ERROR', {
          issues: [{ path: ['year'], code: 'invalid_value', message: 'Tham số không hợp lệ' }],
        });
      const body = await parseBody(request, AdjustLeaveBalanceBody);
      if (body.response) return body.response;
      const denied = self(ctx.ok, userId.data, body.data.note);
      if (denied) return denied;
      const wsId = COMPANY_SCOPE;
      if (Math.abs(year.data - Number(leave.today().slice(0, 4))) > 1)
        return fail(400, 'VALIDATION_ERROR', {
          issues: [{ path: ['year'], code: 'too_big', message: 'Chỉ chỉnh trong ±1 năm' }],
        });
      if (!hr.known(wsId, userId.data))
        return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
      leave.adjustments.set(`${wsId}|${userId.data}|${year.data}`, body.data.adjustmentDays);
      return ok(LeaveBalanceRowDto, rowOf(wsId, userId.data, year.data));
    }),
  ];
}
