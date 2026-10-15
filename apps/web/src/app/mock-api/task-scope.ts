import type { Permission } from '@taskflow/contracts/rbac';
import type { ProjectDto } from '@taskflow/contracts/project';
import type { TaskDto } from '@taskflow/contracts/task';

import type { MockBoard } from './mock-board';
import type { MockDb } from './mock-db';
import { forbiddenUnless, originClientId, requireMember, type MemberContext } from './mock-guard';
import { fail } from './respond';

type Params = Readonly<Record<string, string | readonly string[] | undefined>>;

export type TaskRequest = Readonly<{
  ctx: MemberContext;
  project: ProjectDto;
  /** Có khi URL có `:taskId` (task chưa xóa). */
  task: TaskDto | undefined;
  origin: { actorId: string; originClientId: string | null };
}>;

/**
 * Phần chung mọi route task: 401 → 400 (uuid) → 404 workspace/project/task → 403 min role.
 * `includeDeleted`: audit-logs vẫn đọc được task đã xóa mềm (R16).
 */
export function taskRequest(
  db: MockDb,
  board: MockBoard,
  request: Request,
  params: Params,
  permission: Permission | null,
  includeDeleted = false,
): { ok: TaskRequest; response?: never } | { response: Response; ok?: never } {
  const member = requireMember(request, db, params);
  if (member.response) return member;
  const project = board.getProject(String(params.wsId), String(params.projectId));
  if (!project) return { response: fail(404, 'RESOURCE_NOT_FOUND', { resource: 'project' }) };
  const taskId = params.taskId === undefined ? undefined : String(params.taskId);
  const task = taskId === undefined ? undefined : board.getTask(project.id, taskId);
  const exists =
    task !== undefined || (includeDeleted && taskId && board.hasTask(project.id, taskId));
  if (taskId !== undefined && !exists) {
    return { response: fail(404, 'RESOURCE_NOT_FOUND', { resource: 'task' }) };
  }
  const denied = permission ? forbiddenUnless(member.ok, permission) : null;
  if (denied) return { response: denied };
  return {
    ok: {
      ctx: member.ok,
      project,
      task,
      origin: { actorId: member.ok.user.id, originClientId: originClientId(request) },
    },
  };
}

export const archivedResponse = (project: ProjectDto) =>
  fail(422, 'PROJECT_ARCHIVED', { projectId: project.id });

export const userRef = (ctx: MemberContext) => ({ id: ctx.user.id, fullName: ctx.user.fullName });
