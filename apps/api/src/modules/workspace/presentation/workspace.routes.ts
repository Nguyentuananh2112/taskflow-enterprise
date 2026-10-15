import {
  AddMemberBody,
  ChangeMemberRoleBody,
  CreateProjectBody,
  CreateWorkspaceBody,
  DeleteWorkspaceBody,
  ListMembersQuery,
  ListProjectsQuery,
  ListWorkspacesQuery,
  MemberParams,
  ProjectParams,
  UpdateProjectBody,
  UpdateWorkspaceBody,
  WorkspaceParams,
} from '@taskflow/contracts';
import { Router, type RequestHandler } from 'express';
import type * as z from 'zod';

import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { validate } from '../../../core/http/validate';
import type { WorkspaceAccess } from '../application/adapters/workspace-access';
import type { ParentPermission, Permission } from '../domain/roles';
import { loadMembership, permit } from './membership';
import type { ProjectController } from './project.controller';
import type { WorkspaceController } from './workspace.controller';

export interface WorkspaceRouteDeps {
  workspaces: WorkspaceController;
  projects: ProjectController;
  access: Pick<WorkspaceAccess, 'resolveActor'>;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

/**
 * `/api/v1/workspaces` (data-and-api §2.5–2.6). Thứ tự kiểm (§2.2): 401 authenticate → 400 params
 * → 404 tenant (loadMembership) → 403 quyền tối thiểu → 400 body/query → use case (403 Policy,
 * 422, 409). Body được validate SAU khi biết có quyền ⇒ không lộ luật validate cho người ngoài.
 */
export function workspaceRoutes(d: WorkspaceRouteDeps): Router {
  const router = Router();
  const ws = d.workspaces;
  const pj = d.projects;
  router.use(d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated));

  /** Chuỗi chuẩn cho route dưới `/:wsId`. */
  const scoped = (
    params: z.ZodType,
    permission: Permission | ParentPermission,
    input: { body?: z.ZodType; query?: z.ZodType } = {},
  ): RequestHandler[] => [
    validate({ params }),
    loadMembership(d.access),
    permit(permission),
    ...(input.body || input.query ? [validate(input)] : []),
  ];

  router.get('/', validate({ query: ListWorkspacesQuery }), ws.list);
  router.post(
    '/',
    ...d.limit(RATE_LIMIT_RULES.createWorkspace),
    validate({ body: CreateWorkspaceBody }),
    ws.create,
  );
  router.get('/:wsId', ...scoped(WorkspaceParams, 'workspace:read'), ws.get);
  router.patch(
    '/:wsId',
    ...scoped(WorkspaceParams, 'workspace:update', { body: UpdateWorkspaceBody }),
    ws.update,
  );
  router.delete(
    '/:wsId',
    ...scoped(WorkspaceParams, 'workspace:delete', { body: DeleteWorkspaceBody }),
    ws.remove,
  );
  // Khôi phục: workspace đã xóa nên không qua loadMembership — use case tự kiểm OWNER (ADR-103).
  router.post(
    '/:wsId/restore',
    validate({ params: WorkspaceParams }),
    ...d.limit(RATE_LIMIT_RULES.restoreWorkspace),
    ws.restore,
  );

  router.get(
    '/:wsId/members',
    ...scoped(WorkspaceParams, 'member:read', { query: ListMembersQuery }),
    ws.listMembers,
  );
  router.post(
    '/:wsId/members',
    ...scoped(WorkspaceParams, 'member:add'),
    ...d.limit(RATE_LIMIT_RULES.addMember),
    validate({ body: AddMemberBody }),
    ws.addMember,
  );
  router.patch(
    '/:wsId/members/:userId',
    ...scoped(MemberParams, 'member:update-role', { body: ChangeMemberRoleBody }),
    ws.changeRole,
  );
  // Min role `member:leave`; xóa người khác cần thêm `member:remove` — Policy trong use case.
  router.delete('/:wsId/members/:userId', ...scoped(MemberParams, 'member:leave'), ws.removeMember);

  router.get(
    '/:wsId/projects',
    ...scoped(WorkspaceParams, 'project:read', { query: ListProjectsQuery }),
    pj.list,
  );
  router.post(
    '/:wsId/projects',
    ...scoped(WorkspaceParams, 'project:create', { body: CreateProjectBody }),
    pj.create,
  );
  router.get('/:wsId/projects/:projectId', ...scoped(ProjectParams, 'project:read'), pj.get);
  router.patch(
    '/:wsId/projects/:projectId',
    ...scoped(ProjectParams, 'project:update', { body: UpdateProjectBody }),
    pj.update,
  );
  router.post(
    '/:wsId/projects/:projectId/archive',
    ...scoped(ProjectParams, 'project:archive'),
    pj.archive,
  );
  router.post(
    '/:wsId/projects/:projectId/unarchive',
    ...scoped(ProjectParams, 'project:archive'),
    pj.unarchive,
  );
  return router;
}
