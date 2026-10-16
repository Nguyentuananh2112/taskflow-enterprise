import { Uuid } from '@taskflow/contracts/common';
import {
  CreateWorkspaceBody,
  DeleteWorkspaceBody,
  DeletedWorkspaceDto,
  ListWorkspacesQuery,
  UpdateWorkspaceBody,
  WorkspaceDto,
} from '@taskflow/contracts/workspace';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { MockBoard } from './mock-board';
import type { MockDb } from './mock-db';
import { authenticate, forbiddenUnless, originClientId, requireMember } from './mock-guard';
import type { WorkspaceRow } from './mock-workspaces';
import type { RateLimiter } from './request-guards';
import { fail, ok, parseBody, parseQuery } from './respond';
import { accessRevoked } from './workspace-events';

// Workspace (data-and-api §2.5, ADR-047/050/094). Thứ tự lỗi như API: 401 → 400 uuid → 404 → 403 → 400 body.

const toDto = (w: WorkspaceRow, myRole: WorkspaceDto['myRole']): WorkspaceDto => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  myRole,
  myGrants: [], // T-041 nối grants thật (ADR-119)
  createdAt: w.createdAt,
  updatedAt: w.updatedAt,
});

/** Workspace đã xóa mềm luôn có deletedAt/purgeAt. */
const toDeletedDto = (w: WorkspaceRow): DeletedWorkspaceDto => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  deletedAt: w.deletedAt as string,
  purgeAt: w.purgeAt as string,
});

const slugConflict = () => fail(409, 'RESOURCE_CONFLICT', { field: 'slug', reason: 'taken' });

export function createWorkspaceHandlers(
  baseUrl: string,
  db: MockDb,
  board: MockBoard,
  limit: RateLimiter,
): HttpHandler[] {
  const url = (path: string) => `${baseUrl}${path}`;
  const ws = db.workspaces;

  return [
    http.get(url('/workspaces'), ({ request }) => {
      const auth = authenticate(request, db);
      if (auth.response) return auth.response;
      const query = parseQuery(request, ListWorkspacesQuery);
      if (query.response) return query.response;
      if (query.data.deleted === 'true') {
        const deleted = ws.deletedOwnedBy(auth.ok.id).map(toDeletedDto);
        return ok(z.array(DeletedWorkspaceDto), deleted);
      }
      return ok(
        z.array(WorkspaceDto),
        ws.activeOf(auth.ok.id).map(({ workspace, member }) => toDto(workspace, member.role)),
      );
    }),

    http.post(url('/workspaces'), async ({ request }) => {
      const auth = authenticate(request, db);
      if (auth.response) return auth.response;
      const limited = limit(`create-ws:${auth.ok.id}`, 10);
      if (limited) return limited;
      const body = await parseBody(request, CreateWorkspaceBody);
      if (body.response) return body.response;
      if (body.data.slug !== undefined && ws.slugTaken(body.data.slug)) return slugConflict();
      const id = db.createWorkspace(body.data.name, body.data.slug, auth.ok.id);
      return ok(WorkspaceDto, toDto(ws.active(id) as WorkspaceRow, 'OWNER'), { status: 201 });
    }),

    http.get(url('/workspaces/:wsId'), ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      return ok(
        WorkspaceDto,
        toDto(ws.active(String(params.wsId)) as WorkspaceRow, ctx.ok.membership.role),
      );
    }),

    http.patch(url('/workspaces/:wsId'), async ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = forbiddenUnless(ctx.ok, 'workspace:update');
      if (denied) return denied;
      const body = await parseBody(request, UpdateWorkspaceBody);
      if (body.response) return body.response;
      const id = String(params.wsId);
      // R19: KHÔNG tự lowercase — chữ hoa đã bị schema chặn (400); trùng/dành riêng ⇒ 409 field slug.
      if (body.data.slug !== undefined && ws.slugTaken(body.data.slug, id)) return slugConflict();
      const row = ws.update(id, {
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.slug !== undefined ? { slug: body.data.slug } : {}),
      });
      return ok(WorkspaceDto, toDto(row, ctx.ok.membership.role));
    }),

    http.delete(url('/workspaces/:wsId'), async ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = forbiddenUnless(ctx.ok, 'workspace:delete');
      if (denied) return denied;
      const body = await parseBody(request, DeleteWorkspaceBody);
      if (body.response) return body.response;
      const id = String(params.wsId);
      const row = ws.active(id) as WorkspaceRow;
      if (body.data.confirmSlug !== row.slug) {
        return fail(400, 'VALIDATION_ERROR', {
          issues: [
            { path: ['confirmSlug'], code: 'mismatch', message: 'Slug xác nhận không khớp.' },
          ],
        });
      }
      const memberIds = ws.membersOf(id).map((m) => m.userId);
      const deleted = ws.softDelete(id);
      accessRevoked(
        board,
        { actorId: ctx.ok.user.id, originClientId: originClientId(request) },
        id,
        memberIds,
      );
      return ok(DeletedWorkspaceDto, toDeletedDto(deleted));
    }),

    // ADR-050/103: không qua requireMember (workspace đã xóa ⇒ luôn 404 ở đó); một kiểu 404 cho mọi thất bại.
    http.post(url('/workspaces/:wsId/restore'), ({ request, params }) => {
      const auth = authenticate(request, db);
      if (auth.response) return auth.response;
      if (!Uuid.safeParse(params.wsId).success) {
        return fail(400, 'VALIDATION_ERROR', {
          issues: [{ path: ['wsId'], code: 'invalid_format', message: 'Không phải UUID hợp lệ' }],
        });
      }
      const limited = limit(`restore-ws:${auth.ok.id}`, 10);
      if (limited) return limited;
      const restored = ws.restore(String(params.wsId), auth.ok.id);
      if (!restored) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'workspace' });
      return ok(WorkspaceDto, toDto(restored, 'OWNER'));
    }),
  ];
}
