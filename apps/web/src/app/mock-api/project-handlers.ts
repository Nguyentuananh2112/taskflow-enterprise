import {
  CreateProjectBody,
  ListProjectsQuery,
  ProjectDto,
  UpdateProjectBody,
} from '@taskflow/contracts/project';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { MockBoard } from './mock-board';
import type { MockDb } from './mock-db';
import { forbiddenUnless, originClientId, requireMember } from './mock-guard';
import { fail, ok, paginate, parseBody, parseQuery } from './respond';
import { projectUpdated } from './workspace-events';

// Project (data-and-api §2.6). keyPrefix bất biến, unique trong workspace (409 field keyPrefix);
// project lưu trữ ⇒ sửa 422 PROJECT_ARCHIVED; archive/unarchive idempotent.

export function createProjectHandlers(
  baseUrl: string,
  db: MockDb,
  board: MockBoard,
): HttpHandler[] {
  const base = `${baseUrl}/workspaces/:wsId/projects`;
  const notFound = () => fail(404, 'RESOURCE_NOT_FOUND', { resource: 'project' });

  const archive = (archived: boolean) =>
    http.post(`${base}/:projectId/${archived ? 'archive' : 'unarchive'}`, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const project = board.getProject(String(params.wsId), String(params.projectId));
      if (!project) return notFound();
      const denied = forbiddenUnless(ctx.ok, 'project:archive');
      if (denied) return denied;
      if (project.isArchived === archived) return ok(ProjectDto, project);
      const at = board.iso();
      const next = {
        ...project,
        isArchived: archived,
        archivedAt: archived ? at : null,
        updatedAt: at,
      };
      board.saveProject(next);
      projectUpdated(
        board,
        { actorId: ctx.ok.user.id, originClientId: originClientId(request) },
        next,
      );
      return ok(ProjectDto, next);
    });

  return [
    http.get(base, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const query = parseQuery(request, ListProjectsQuery);
      if (query.response) return query.response;
      const projects = board.listProjects(String(params.wsId), query.data.archived);
      const page = paginate(projects, query.data.cursor, query.data.limit);
      return ok(z.array(ProjectDto), page.data, { page: page.page });
    }),

    http.post(base, async ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const denied = forbiddenUnless(ctx.ok, 'project:create');
      if (denied) return denied;
      const body = await parseBody(request, CreateProjectBody);
      if (body.response) return body.response;
      const wsId = String(params.wsId);
      if (board.listProjects(wsId, 'all').some((p) => p.keyPrefix === body.data.keyPrefix)) {
        return fail(409, 'RESOURCE_CONFLICT', { field: 'keyPrefix', reason: 'taken' });
      }
      const created = board.createProject(wsId, body.data);
      const project = { ...created, description: body.data.description ?? null };
      board.saveProject(project);
      return ok(ProjectDto, project, { status: 201 });
    }),

    http.get(`${base}/:projectId`, ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const project = board.getProject(String(params.wsId), String(params.projectId));
      return project ? ok(ProjectDto, project) : notFound();
    }),

    http.patch(`${base}/:projectId`, async ({ request, params }) => {
      const ctx = requireMember(request, db, params);
      if (ctx.response) return ctx.response;
      const project = board.getProject(String(params.wsId), String(params.projectId));
      if (!project) return notFound();
      const denied = forbiddenUnless(ctx.ok, 'project:update');
      if (denied) return denied;
      const body = await parseBody(request, UpdateProjectBody);
      if (body.response) return body.response;
      if (project.isArchived) return fail(422, 'PROJECT_ARCHIVED', { projectId: project.id });
      const next = {
        ...project,
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.description !== undefined ? { description: body.data.description } : {}),
        updatedAt: board.iso(),
      };
      board.saveProject(next);
      projectUpdated(
        board,
        { actorId: ctx.ok.user.id, originClientId: originClientId(request) },
        next,
      );
      return ok(ProjectDto, next);
    }),

    archive(true),
    archive(false),
  ];
}
