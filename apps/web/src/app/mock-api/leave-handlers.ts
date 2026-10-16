import { Uuid } from '@taskflow/contracts/common';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import {
  CancelLeaveRequestBody,
  CreateLeaveRequestBody,
  LeaveBalanceDto,
  LeavePreviewDto,
  LeavePreviewQuery,
  LeaveRequestDto,
} from '@/shared/api/m3-provisional';

import type { MockDb } from './mock-db';
import { requireMember } from './mock-guard';
import { conflict, evaluate, selfOnly, strip, type Leave, type MockLeave } from './mock-leave';
import { fail, ok, parseBody, parseQuery } from './respond';

// Nghỉ phép (attendance-leave.md §5, ADR-122; mã lỗi TL chốt): VIEWER 403 `leave:self`; 422 rule
// NO_WORKING_DAYS / LEAVE_SPANS_YEARS / INSUFFICIENT_BALANCE; 409 reason overlapping_leave (AM + PM cùng
// ngày hợp lệ) / invalid_transition; expectedVersion cũ ⇒ 409 VERSION_CONFLICT; hủy đơn người khác ⇒ 404.
// Ngày làm = T2–T7 như lịch mock (chưa có ngày lễ). Phép năm mặc định 12 ngày.

export function createLeaveHandlers(baseUrl: string, db: MockDb, leave: MockLeave): HttpHandler[] {
  const base = `${baseUrl}/workspaces/:wsId`;
  return [
    http.get(`${base}/leave-requests`, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = selfOnly(ctx.ok);
      if (denied) return denied;
      const mine = leave.items
        .filter((l) => l.workspaceId === params.wsId && l.userId === ctx.ok.user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return ok(z.array(LeaveRequestDto), mine.map(strip));
    }),
    http.get(`${base}/leave-requests/preview`, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, LeavePreviewQuery);
      if (query.response) return query.response;
      const checked = evaluate(leave, ctx.ok, String(params.wsId), query.data);
      if (checked.response) return checked.response;
      const bal = leave.balance(
        String(params.wsId),
        ctx.ok.user.id,
        Number(query.data.startDate.slice(0, 4)),
      );
      return ok(LeavePreviewDto, {
        days: checked.days,
        // Số dư TRƯỚC đơn này = remainingDays của leave-balances/me (D chốt); khác ANNUAL ⇒ null.
        remainingDays: query.data.type === 'ANNUAL' ? bal.remainingDays : null,
      });
    }),
    http.post(`${base}/leave-requests`, async ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, CreateLeaveRequestBody);
      if (body.response) return body.response;
      const b = body.data;
      const wsId = String(params.wsId);
      const checked = evaluate(leave, ctx.ok, wsId, b);
      if (checked.response) return checked.response;
      const at = new Date().toISOString();
      const userId = ctx.ok.user.id;
      const item: Leave = {
        type: b.type,
        startDate: b.startDate,
        endDate: b.endDate,
        dayPart: b.dayPart,
        reason: b.reason?.trim() ? b.reason.trim() : null,
        id: crypto.randomUUID(),
        workspaceId: wsId,
        userId,
        user: { id: userId, fullName: ctx.ok.user.fullName },
        days: checked.days,
        status: 'PENDING',
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      leave.items.push(item);
      return ok(LeaveRequestDto, strip(item), { status: 201 });
    }),
    http.post(`${base}/leave-requests/:id/cancel`, async ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = selfOnly(ctx.ok);
      if (denied) return denied;
      const body = await parseBody(request, CancelLeaveRequestBody);
      if (body.response) return body.response;
      const l = leave.items.find(
        (x) => x.id === params.id && x.workspaceId === params.wsId && x.userId === ctx.ok.user.id,
      );
      if (!l || !Uuid.safeParse(params.id).success)
        return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'leave_request' });
      if (l.version !== body.data.expectedVersion)
        return fail(409, 'VERSION_CONFLICT', { currentVersion: l.version, current: strip(l) });
      const ok_ =
        l.status === 'PENDING' || (l.status === 'APPROVED' && l.startDate > leave.today());
      if (!ok_) return conflict('invalid_transition');
      Object.assign(l, {
        status: 'CANCELLED',
        version: l.version + 1,
        updatedAt: new Date().toISOString(),
      });
      return ok(LeaveRequestDto, strip(l));
    }),
    http.get(`${base}/leave-balances/me`, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = selfOnly(ctx.ok);
      if (denied) return denied;
      const year = Number(new URL(request.url).searchParams.get('year'));
      return ok(LeaveBalanceDto, leave.balance(String(params.wsId), ctx.ok.user.id, year));
    }),
  ];
}
