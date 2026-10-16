import type { WorkspaceRole } from '@taskflow/contracts/rbac';
import {
  AddMemberBody,
  ChangeMemberRoleBody,
  ChangeMemberRoleResponse,
  ListMembersQuery,
  MemberDto,
  RemoveMemberResponse,
  SetMemberGrantsBody,
} from '@taskflow/contracts/workspace';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { MockBoard } from './mock-board';
import type { MockDb } from './mock-db';
import {
  forbiddenUnless,
  forbiddenUnlessGranted,
  originClientId,
  requireMember,
  type MemberContext,
} from './mock-guard';
import type { RateLimiter } from './request-guards';
import { fail, ok, paginate, parseBody, parseQuery } from './respond';
import { accessRevoked, grantsChanged, roleChanged, unassignAll } from './workspace-events';

// Thành viên (data-and-api §2.5, security.md §3.2, ADR-044/046). Hành vi theo use case của API:
// add-member / change-member-role / remove-member (thứ tự lỗi ghi ở từng handler).

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
  const toDto = (wsId: string, userId: string): MemberDto => {
    const row = db.membersOf(wsId).find((m) => m.user.id === userId);
    if (!row) throw new Error('mock: thành viên không tồn tại');
    return {
      userId: row.user.id,
      email: row.user.email,
      fullName: row.user.fullName,
      role: row.membership.role,
      grants: ws.member(wsId, userId)?.grants ?? [], // ADR-119
      joinedAt: row.joinedAt,
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

    // 403 quyền chung → 400 body → 403 cấp role → 404 user (không lộ email tồn tại trước khi kiểm quyền) → 409.
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
      const user = db.findUserByEmail(body.data.email);
      if (!user) return notFoundUser();
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

    // ADR-119: `hr:grant` (chỉ OWNER) 403 → 400 body → 404 user → 422 GRANT_NOT_ALLOWED (OWNER / VIEWER).
    http.put(`${base}/:userId/grants`, async ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = forbiddenUnlessGranted(ctx.ok, db, 'hr:grant');
      if (denied) return denied;
      const body = await parseBody(request, SetMemberGrantsBody);
      if (body.response) return body.response;
      const wsId = String(params.wsId);
      const target = ws.member(wsId, String(params.userId));
      if (!target) return notFoundUser();
      if (body.data.grants.length > 0 && (target.role === 'OWNER' || target.role === 'VIEWER')) {
        return fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'GRANT_NOT_ALLOWED' });
      }
      ws.setGrants(wsId, target.userId, body.data.grants);
      grantsChanged(board, origin(ctx.ok, request), wsId, target.userId, target.grants);
      return ok(MemberDto, toDto(wsId, target.userId));
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
