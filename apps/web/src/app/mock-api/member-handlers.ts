import type { WorkspaceRole } from '@taskflow/contracts/rbac';
import {
  AddMemberBody,
  ChangeMemberRoleBody,
  ChangeMemberRoleResponse,
  ListMembersQuery,
  MemberDto,
  RemoveMemberResponse,
} from '@taskflow/contracts/workspace';
import { MemberCandidateDto, MemberCandidatesQuery } from '@taskflow/contracts/company';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { MockBoard } from './mock-board';
import type { MockDb } from './mock-db';
import { forbiddenUnless, originClientId, requireMember, type MemberContext } from './mock-guard';
import type { RateLimiter } from './request-guards';
import { fail, ok, paginate, parseBody, parseQuery } from './respond';
import { accessRevoked, roleChanged, unassignAll } from './workspace-events';

// Thành viên (data-and-api §2.5, security.md §3.2, ADR-044/046). Hành vi theo use case của API:
// add-member / change-member-role / remove-member (thứ tự lỗi ghi ở từng handler). Mốc 3.5 (ADR-134): thêm theo
// `userId` của NHÂN VIÊN công ty (chọn từ `member-candidates`), workspace không còn grants.

/** PM chỉ cấp MEMBER/VIEWER; OWNER cấp bất kỳ. */
const canGrant = (actor: WorkspaceRole, role: WorkspaceRole) =>
  actor === 'OWNER' || (actor === 'PM' && (role === 'MEMBER' || role === 'VIEWER'));

const lastOwner = () => fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'LAST_OWNER' });
const notFoundUser = () => fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });

export function createMemberHandlers(
  baseUrl: string,
  db: MockDb,
  board: MockBoard,
  limit: RateLimiter,
): HttpHandler[] {
  const base = `${baseUrl}/workspaces/:wsId/members`;
  const ws = db.workspaces;
  // Mốc 6 (ADR-142): URL hiện tại (variant 64); không có ảnh ⇒ không thêm trường (giữ DTO cũ của các test trước).
  const withAvatar = (userId: string) => {
    const avatarUrl = db.company.avatarOf(userId);
    return avatarUrl ? { avatarUrl } : {};
  };
  const toDto = (wsId: string, userId: string): MemberDto => {
    const row = db.membersOf(wsId).find((m) => m.user.id === userId);
    if (!row) throw new Error('mock: thành viên không tồn tại');
    return {
      userId: row.user.id,
      email: row.user.email,
      fullName: row.user.fullName,
      role: row.membership.role,
      joinedAt: row.joinedAt,
      ...withAvatar(row.user.id),
    };
  };
  const ownersOf = (wsId: string) => ws.membersOf(wsId).filter((m) => m.role === 'OWNER');
  const origin = (ctx: MemberContext, request: Request) => ({
    actorId: ctx.user.id,
    originClientId: originClientId(request),
  });
  const actorRef = (ctx: MemberContext) => ({ id: ctx.user.id, fullName: ctx.user.fullName });

  return [
    http.get(base, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, ListMembersQuery);
      if (query.response) return query.response;
      const q = query.data.q?.toLowerCase();
      const wsId = String(params.wsId);
      const members = db
        .membersOf(wsId)
        .filter(({ user }) => !q || `${user.fullName} ${user.email}`.toLowerCase().includes(q))
        .map(({ user }) => toDto(wsId, user.id));
      const page = paginate(members, query.data.cursor, query.data.limit);
      return ok(z.array(MemberDto), page.data, { page: page.page });
    }),

    // `member:add` 403 → 400 q (2..100) → nhân viên đang làm / chờ kích hoạt, chưa ở ws, khớp tên/email; ≤ 20; chỉ id, tên,
    // email (ADR-134). Người có lịch nghỉ việc không là ứng viên.
    http.get(`${baseUrl}/workspaces/:wsId/member-candidates`, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = forbiddenUnless(ctx.ok, 'member:add');
      if (denied) return denied;
      const query = parseQuery(request, MemberCandidatesQuery);
      if (query.response) return query.response;
      const q = query.data.q.toLowerCase();
      const wsId = String(params.wsId);
      const rows = db.company
        .members()
        .filter(([id, row]) => !row.offboardLastDay && !ws.member(wsId, id))
        .flatMap(([id]) => {
          const u = db.getUser(id);
          return u && `${u.fullName} ${u.email}`.toLowerCase().includes(q)
            ? [{ id, fullName: u.fullName, email: u.email, ...withAvatar(id) }]
            : [];
        })
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
        .slice(0, 20);
      return ok(z.array(MemberCandidateDto), rows);
    }),

    // 403 quyền chung → 400 body → 403 cấp role → 404 user → 422 NOT_ACTIVE_MEMBER (không thuộc công ty / có lịch nghỉ)
    // → 409 đã là thành viên.
    http.post(base, async ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = forbiddenUnless(ctx.ok, 'member:add');
      if (denied) return denied;
      const limited = limit(`add-member:${ctx.ok.user.id}`, 30);
      if (limited) return limited;
      const body = await parseBody(request, AddMemberBody);
      if (body.response) return body.response;
      if (!canGrant(ctx.ok.membership.role, body.data.role)) {
        return fail(403, 'FORBIDDEN_ACCESS', { required: 'member:add' });
      }
      const user = db.getUser(body.data.userId);
      if (!user) return notFoundUser();
      const employee = db.company.row(user.id);
      if (!employee || employee.offboardLastDay) {
        return fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'NOT_ACTIVE_MEMBER' });
      }
      const wsId = String(params.wsId);
      if (ws.member(wsId, user.id)) {
        // Như API thật (`CONFLICTS` của prisma/db.ts): không có `field` (G1 I2).
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'already_member' });
      }
      ws.setMember(wsId, user.id, body.data.role);
      return ok(MemberDto, toDto(wsId, user.id), { status: 201 });
    }),

    http.patch(`${base}/:userId`, async ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = forbiddenUnless(ctx.ok, 'member:update-role');
      if (denied) return denied;
      const body = await parseBody(request, ChangeMemberRoleBody);
      if (body.response) return body.response;
      const wsId = String(params.wsId);
      const target = ws.member(wsId, String(params.userId));
      if (!target) return notFoundUser();
      if (target.role === body.data.role) {
        return ok(ChangeMemberRoleResponse, {
          member: toDto(wsId, target.userId),
          unassignedTaskCount: 0,
        });
      }
      if (target.role === 'OWNER' && ownersOf(wsId).length === 1) return lastOwner();
      ws.setMember(wsId, target.userId, body.data.role);
      const o = origin(ctx.ok, request);
      const unassignedTaskCount =
        body.data.role === 'VIEWER'
          ? unassignAll(board, o, actorRef(ctx.ok), wsId, target.userId)
          : 0;
      roleChanged(board, o, wsId, target.userId, body.data.role);
      return ok(ChangeMemberRoleResponse, {
        member: toDto(wsId, target.userId),
        unassignedTaskCount,
      });
    }),

    // Tự rời: `member:leave` (mọi role); người khác: `member:remove`. 403 → 404 → 403 theo role mục tiêu → 422.
    http.delete(`${base}/:userId`, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const userId = String(params.userId);
      const isSelf = userId === ctx.ok.user.id;
      const denied = forbiddenUnless(ctx.ok, isSelf ? 'member:leave' : 'member:remove');
      if (denied) return denied;
      const wsId = String(params.wsId);
      const target = ws.member(wsId, userId);
      if (!target) return notFoundUser();
      const actorRole = ctx.ok.membership.role;
      if (!isSelf && actorRole === 'PM' && (target.role === 'OWNER' || target.role === 'PM')) {
        return fail(403, 'FORBIDDEN_ACCESS', { required: 'member:remove' });
      }
      if (target.role === 'OWNER' && ownersOf(wsId).length === 1) return lastOwner();
      ws.removeMember(wsId, userId);
      const o = origin(ctx.ok, request);
      const unassignedTaskCount = unassignAll(board, o, actorRef(ctx.ok), wsId, userId);
      accessRevoked(board, o, wsId, [userId]);
      return ok(RemoveMemberResponse, { userId, unassignedTaskCount });
    }),
  ];
}
