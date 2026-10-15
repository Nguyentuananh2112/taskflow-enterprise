import type { Request, RequestHandler } from 'express';
import type * as z from 'zod';

import { ForbiddenError } from '../../../core/errors';
import { requireUser } from '../../../core/http/request-user';
import { validationErrorFromZod } from '../../../core/http/zod';
import type { IRolePermissions, TaskActor, TaskPermission } from '../application/task-actor';

/**
 * Nguồn membership — module Workspace cung cấp (`WorkspaceAccess.resolveActor`, khớp theo cấu trúc);
 * wire ở composition root, module Task không import nội bộ Workspace (ADR-093).
 * Không phải thành viên / workspace không tồn tại / đã xóa mềm ⇒ ném 404 (ADR-020).
 */
export interface TaskMembershipSource {
  resolveActor(workspaceId: string, userId: string): Promise<Pick<TaskActor, 'userId' | 'role'>>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- cách chuẩn mở rộng Request của Express
  namespace Express {
    interface Request {
      /** Actor của module Task trong workspace của URL — gắn bởi `loadTaskActor`. */
      taskActor?: TaskActor;
    }
  }
}

/** Lớp 1 của tenant guard (ADR-020): thành viên workspace trên URL; lớp 2 (project/task ∈ ws) ở use case. */
export function loadTaskActor(source: TaskMembershipSource): RequestHandler {
  return async (req, _res, next) => {
    const { wsId } = req.params as { wsId: string };
    const { userId, role } = await source.resolveActor(wsId, requireUser(req).id);
    req.taskActor = { userId, role };
    next();
  };
}

export function taskActorOf(req: Request): TaskActor {
  if (!req.taskActor) throw new Error('loadTaskActor chưa chạy cho route này (lỗi wiring)');
  return req.taskActor;
}

/**
 * Validate body/query nhưng giữ thứ tự "403 trước 400 body" (data-and-api §2.2): input sai từ người
 * KHÔNG có quyền tối thiểu ⇒ 403 (không lộ luật validate). Input hợp lệ ⇒ để use case quyết theo
 * đúng thứ tự 404 (project/task ∉ ws) → 403 (Policy) → 422 → 409.
 */
export function validateOrForbid(
  part: 'body' | 'query',
  schema: z.ZodType,
  minimum: TaskPermission,
  permissions: IRolePermissions,
): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (result.success) {
      Object.defineProperty(req, part, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      next();
      return;
    }
    const actor = taskActorOf(req);
    next(
      permissions.allows(actor.role, minimum)
        ? validationErrorFromZod(result.error)
        : new ForbiddenError(minimum),
    );
  };
}
