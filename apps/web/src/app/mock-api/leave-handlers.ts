import { Uuid } from '@taskflow/contracts/common';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import {
  CancelLeaveRequestBody,
  CreateLeaveRequestBody,
  LeaveBalanceDto,
  LeaveRequestDto,
} from '@/shared/api/m3-provisional';

import type { MockAttendance } from './mock-attendance';
import type { MockDb } from './mock-db';
import { requireMember, type MemberContext } from './mock-guard';
import { fail, ok, parseBody } from './respond';

// Nghỉ phép (attendance-leave.md §5, ADR-122; mã lỗi TL chốt): VIEWER 403 `leave:self`; 422 rule
// NO_WORKING_DAYS / LEAVE_SPANS_YEARS / INSUFFICIENT_BALANCE; 409 reason overlapping_leave (AM + PM cùng
// ngày hợp lệ) / invalid_transition; expectedVersion cũ ⇒ 409 VERSION_CONFLICT; hủy đơn người khác ⇒ 404.
// Ngày làm = T2–T7 như lịch mock (chưa có ngày lễ). Phép năm mặc định 12 ngày.

type Leave = z.infer<typeof LeaveRequestDto> & { workspaceId: string };
const ENTITLED = 12;

const dayList = (start: string, end: string) => {
  const out: string[] = [];
  for (
    let t = Date.parse(`${start}T00:00:00Z`);
    t <= Date.parse(`${end}T00:00:00Z`);
    t += 86_400_000
  ) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};
const isWorkday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0;
const live = (l: Leave) => l.status === 'PENDING' || l.status === 'APPROVED';
const halves = (l: Pick<Leave, 'dayPart'>) => (l.dayPart === 'FULL' ? ['AM', 'PM'] : [l.dayPart]);

export class MockLeave {
  items: Leave[] = [];
  constructor(
    private readonly attendance: MockAttendance,
    private readonly now: () => number,
  ) {}

  balance(wsId: string, userId: string, year: number) {
    const mine = this.items.filter(
      (l) =>
        l.workspaceId === wsId &&
        l.userId === userId &&
        l.type === 'ANNUAL' &&
        l.startDate.startsWith(String(year)),
    );
    const sum = (s: string) => mine.filter((l) => l.status === s).reduce((n, l) => n + l.days, 0);
    const usedDays = sum('APPROVED');
    const pendingDays = sum('PENDING');
    return {
      year,
      entitledDays: ENTITLED,
      adjustmentDays: 0,
      usedDays,
      pendingDays,
      remainingDays: ENTITLED - usedDays,
    };
  }

  /** HR duyệt (test/dev) — T-041c sẽ có route thật. */
  decide(id: string, status: 'APPROVED' | 'REJECTED', by: { id: string; fullName: string }) {
    const l = this.items.find((x) => x.id === id);
    if (!l) return;
    Object.assign(l, {
      status,
      decidedBy: by,
      decidedAt: new Date(this.now()).toISOString(),
      version: l.version + 1,
    });
  }

  today = () => this.attendance.today();
}

const strip = ({ workspaceId: _w, ...dto }: Leave) => dto;
const selfOnly = (ctx: MemberContext) =>
  ctx.membership.role === 'VIEWER'
    ? fail(403, 'FORBIDDEN_ACCESS', { required: 'leave:self' })
    : null;
const rule = (r: string) => fail(422, 'BUSINESS_RULE_VIOLATION', { rule: r });
const conflict = (reason: string) => fail(409, 'RESOURCE_CONFLICT', { reason });

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
    http.post(`${base}/leave-requests`, async ({ request, params }) => {
      // Thứ tự lỗi D chốt: 400 → 422 LEAVE_SPANS_YEARS → 403 → 422 NO_WORKING_DAYS → 409 → 422 số dư.
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, CreateLeaveRequestBody);
      if (body.response) return body.response;
      const b = body.data;
      if (b.startDate.slice(0, 4) !== b.endDate.slice(0, 4)) return rule('LEAVE_SPANS_YEARS');
      const denied = selfOnly(ctx.ok);
      if (denied) return denied;
      const work = dayList(b.startDate, b.endDate).filter(isWorkday);
      if (work.length === 0) return rule('NO_WORKING_DAYS');
      const days = b.dayPart === 'FULL' ? work.length : 0.5;
      const wsId = String(params.wsId);
      const userId = ctx.ok.user.id;
      const clash = leave.items.find(
        (l) =>
          l.workspaceId === wsId &&
          l.userId === userId &&
          live(l) &&
          l.startDate <= b.endDate &&
          b.startDate <= l.endDate &&
          (l.startDate !== l.endDate ||
            b.startDate !== b.endDate ||
            halves(l).some((h) => halves(b).includes(h))),
      );
      if (clash)
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'overlapping_leave', requestId: clash.id });
      if (b.type === 'ANNUAL') {
        const bal = leave.balance(wsId, userId, Number(b.startDate.slice(0, 4)));
        const left = bal.remainingDays - bal.pendingDays;
        if (left < days) {
          return fail(422, 'BUSINESS_RULE_VIOLATION', {
            rule: 'INSUFFICIENT_BALANCE',
            remainingDays: left,
            requestedDays: days,
          });
        }
      }
      const at = new Date().toISOString();
      const item: Leave = {
        ...b,
        id: crypto.randomUUID(),
        workspaceId: wsId,
        userId,
        user: { id: userId, fullName: ctx.ok.user.fullName },
        days,
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
