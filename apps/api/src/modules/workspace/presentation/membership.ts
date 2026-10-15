import type { Request, RequestHandler } from 'express';

import { requireUser } from '../../../core/http/request-user';
import type { WorkspaceAccess } from '../application/adapters/workspace-access';
import type { GetProjectQuery } from '../application/use-cases/project.queries';
import { requirePermission, type Actor } from '../application/workspace-shared';
import type { ParentPermission, Permission } from '../domain/roles';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- cách chuẩn mở rộng Request của Express
  namespace Express {
    interface Request {
      /** Thành viên đang thao tác trong workspace của URL — gắn bởi `loadMembership`. */
      actor?: Actor;
    }
  }
}

/**
 * Tenant guard (ADR-020): user không phải thành viên / workspace không tồn tại / đã xóa mềm ⇒ 404
 * (không lộ sự tồn tại). Chạy SAU `validate({ params })` để uuid sai trả 400 trước (data-and-api §2.2).
 */
export function loadMembership(access: Pick<WorkspaceAccess, 'resolveActor'>): RequestHandler {
  return async (req, _res, next) => {
    const wsId = (req.params as { wsId: string }).wsId;
    req.actor = await access.resolveActor(wsId, requireUser(req).id);
    next();
  };
}

/**
 * Lớp 2 của tenant guard cho route `/projects/:projectId`: project ∉ workspace ⇒ 404 TRƯỚC khi kiểm
 * quyền (thứ tự security.md: 401 → 400 → 404 → 403 → 400 body). Dùng `GetProjectQuery` (mọi role
 * có `project:read`) ⇒ không bao giờ trả 403 ở bước này.
 */
export function requireProject(getProject: Pick<GetProjectQuery, 'execute'>): RequestHandler {
  return async (req, _res, next) => {
    const { projectId } = req.params as { projectId: string };
    await getProject.execute(actorOf(req), { projectId });
    next();
  };
}

/** Chặn sớm theo role tối thiểu (ADR-021) — Policy chi tiết vẫn kiểm trong use case. ⇒ 403. */
export function permit(permission: Permission | ParentPermission): RequestHandler {
  return (req, _res, next) => {
    requirePermission(actorOf(req), permission);
    next();
  };
}

export function actorOf(req: Request): Actor {
  if (!req.actor) throw new Error('loadMembership chưa chạy cho route này (lỗi wiring)');
  return req.actor;
}
