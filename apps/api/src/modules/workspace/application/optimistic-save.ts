import { ResourceNotFoundError, VersionConflictError } from '../../../core/errors';
import type { Project } from '../domain/project';
import type { Workspace } from '../domain/workspace';
import type { IProjectRepository, IWorkspaceRepository } from './ports/repositories.port';

/**
 * ADR-110: ghi có điều kiện `version`; không khớp ⇒ đọc lại để báo đúng lỗi — đã xóa / không còn
 * ⇒ 404 (giống mọi đường đọc), còn lại ⇒ 409 `VERSION_CONFLICT` (có người khác vừa ghi). Ném trong
 * `uow.run` ⇒ rollback cả transaction.
 */
export async function saveWorkspaceOrFail(
  workspaces: IWorkspaceRepository,
  ws: Workspace,
): Promise<void> {
  if (await workspaces.save(ws)) return;
  const current = await workspaces.findById(ws.id);
  if (!current || current.isDeleted) throw new ResourceNotFoundError('workspace');
  throw new VersionConflictError(current.version);
}

export async function saveProjectOrFail(
  projects: IProjectRepository,
  project: Project,
): Promise<void> {
  if (await projects.save(project)) return;
  const current = await projects.findInWorkspace(project.workspaceId, project.id);
  if (!current) throw new ResourceNotFoundError('project');
  throw new VersionConflictError(current.version);
}
