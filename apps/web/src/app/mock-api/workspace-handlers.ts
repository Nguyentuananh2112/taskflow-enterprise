import { ListProjectsQuery, ProjectDto } from '@taskflow/contracts/project';
import { ProjectUpdatedEvent } from '@taskflow/contracts/realtime';
import { ListMembersQuery, MemberDto, WorkspaceDto } from '@taskflow/contracts/workspace';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { MockBoard } from './mock-board';
import type { MockDb } from './mock-db';
import { forbiddenUnless, originClientId, requireMember } from './mock-guard';
import { fail, ok, paginate, parseQuery } from './respond';

// Workspace / thành viên / project (data-and-api §2.5–2.6) — phần board cần: đọc + lưu trữ project.

const EPOCH = '2026-01-01T00:00:00.000Z';

export function createWorkspaceHandlers(
  baseUrl: string,
  db: MockDb,
  board: MockBoard,
): HttpHandler[] {
  const url = (path: string) => `${baseUrl}${path}`;

  const archive = (archived: boolean) =>
    http.post(
      url(`/workspaces/:wsId/projects/:projectId/${archived ? 'archive' : 'unarchive'}`),
      ({ request, params }) => {
        const ctx = requireMember(request, db, params);
        if (ctx.response) return ctx.response;
        const project = board.getProject(String(params.wsId), String(params.projectId));
        if (!project) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'project' });
        const denied = forbiddenUnless(ctx.ok, 'project:archive');
        if (denied) return denied;
        if (project.isArchived === archived) return ok(ProjectDto, project); // idempotent
        const at = board.iso();
        const next = {
          ...project,
          isArchived: archived,
          archivedAt: archived ? at : null,
          updatedAt: at,
        };
        board.saveProject(next);
        board.publish({
          room: next.id,
          name: 'project:updated',
          payload: ProjectUpdatedEvent.parse({
            eventId: crypto.randomUUID(),
            type: 'project:updated',
            occurredAt: at,
            actorId: ctx.ok.user.id,
            originClientId: originClientId(request),
            data: { project: next },
          }),
        });
        return ok(ProjectDto, next);
      },
    );

  return [
    http.get(url('/workspaces/:wsId'), ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const m = ctx.ok.membership;
      return ok(WorkspaceDto, {
        id: m.workspaceId,
        name: m.workspaceName,
        slug: m.slug,
        myRole: m.role,
        createdAt: EPOCH,
        updatedAt: EPOCH,
      });
    }),

    http.get(url('/workspaces/:wsId/members'), ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, ListMembersQuery);
      if (query.response) return query.response;
      const q = query.data.q?.toLowerCase();
      const members = db
        .membersOf(String(params.wsId))
        .filter(({ user }) => !q || `${user.fullName} ${user.email}`.toLowerCase().includes(q))
        .map(({ user, membership }) => ({
          userId: user.id,
          email: user.email,
          fullName: user.fullName,
          role: membership.role,
          joinedAt: user.createdAt,
        }));
      const page = paginate(members, query.data.cursor, query.data.limit);
      return ok(z.array(MemberDto), page.data, { page: page.page });
    }),

    http.get(url('/workspaces/:wsId/projects'), ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, ListProjectsQuery);
      if (query.response) return query.response;
      const projects = board.listProjects(String(params.wsId), query.data.archived);
      const page = paginate(projects, query.data.cursor, query.data.limit);
      return ok(z.array(ProjectDto), page.data, { page: page.page });
    }),

    http.get(url('/workspaces/:wsId/projects/:projectId'), ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const project = board.getProject(String(params.wsId), String(params.projectId));
      return project
        ? ok(ProjectDto, project)
        : fail(404, 'RESOURCE_NOT_FOUND', { resource: 'project' });
    }),

    archive(true),
    archive(false),
  ];
}
