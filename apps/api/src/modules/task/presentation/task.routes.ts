import {
  AssignTaskBody,
  CreateTaskBody,
  DeleteTaskQuery,
  ListAuditLogsQuery,
  ListTasksQuery,
  MoveTaskBody,
  ProjectParams,
  TaskParams,
  UpdateTaskBody,
} from '@taskflow/contracts';
import { Router, type RequestHandler } from 'express';

import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { validate } from '../../../core/http/validate';
import type { ITaskProjectStore } from '../application/ports/collaborators.port';
import type { ITaskRepository } from '../application/ports/task-repository.port';
import type { IRolePermissions } from '../application/task-actor';
import type { TaskController } from './task.controller';
import {
  loadTaskActor,
  requireTaskScope,
  validateOrForbid,
  type TaskMembershipSource,
} from './task-membership';

export interface TaskRouteDeps {
  controller: TaskController;
  membership: TaskMembershipSource;
  permissions: IRolePermissions;
  /** Tra phạm vi project/task cho thứ tự 404 trước 400 body. */
  scope: {
    projects: Pick<ITaskProjectStore, 'findInWorkspace'>;
    tasks: Pick<ITaskRepository, 'findLive'>;
  };
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

/** Đường dẫn gắn router (mergeParams) dưới `/api/v1`. */
export const TASKS_PATH = '/workspaces/:wsId/projects/:projectId/tasks';

/**
 * `/workspaces/:wsId/projects/:projectId/tasks` (data-and-api §2.7). Thứ tự (security.md): 401
 * authenticate → 400 params (uuid) → 404 không phải thành viên ws → 404 project/task ∉ phạm vi →
 * [400 body nếu có quyền tối thiểu / 403 nếu không] → use case: (kiểm lại 404) → 403 Policy → 422 →
 * 409. Response không cache (`no-store`, ASVS V14.3.2 — audit T-028 F3).
 */
export function taskRoutes(d: TaskRouteDeps): Router {
  const router = Router({ mergeParams: true });
  const c = d.controller;
  const member = (params: typeof ProjectParams | typeof TaskParams, checkTask = true) => [
    validate({ params }),
    loadTaskActor(d.membership),
    requireTaskScope(d.scope, checkTask),
  ];
  const body = (
    schema: Parameters<typeof validateOrForbid>[1],
    minimum: Parameters<typeof validateOrForbid>[2],
  ) => validateOrForbid('body', schema, minimum, d.permissions);
  const query = (
    schema: Parameters<typeof validateOrForbid>[1],
    minimum: Parameters<typeof validateOrForbid>[2],
  ) => validateOrForbid('query', schema, minimum, d.permissions);

  const noStore: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };
  router.use(noStore, d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated));
  router.get('/', ...member(ProjectParams), query(ListTasksQuery, 'task:read'), c.list);
  router.post('/', ...member(ProjectParams), body(CreateTaskBody, 'task:create'), c.create);
  router.get('/:taskId', ...member(TaskParams), c.get);
  router.patch('/:taskId', ...member(TaskParams), body(UpdateTaskBody, 'task:update'), c.update);
  router.patch('/:taskId/move', ...member(TaskParams), body(MoveTaskBody, 'task:move'), c.move);
  router.patch(
    '/:taskId/assignee',
    ...member(TaskParams),
    body(AssignTaskBody, ['task:assign:own', 'task:assign:any']),
    c.assign,
  );
  router.delete(
    '/:taskId',
    ...member(TaskParams),
    query(DeleteTaskQuery, ['task:delete:own', 'task:delete:any']),
    c.remove,
  );
  router.get(
    '/:taskId/audit-logs',
    ...member(TaskParams, false),
    query(ListAuditLogsQuery, 'audit:read'),
    c.auditLogs,
  );
  return router;
}
