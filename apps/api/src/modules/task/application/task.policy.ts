import { ForbiddenError } from '../../../core/errors';
import type { IRolePermissions, TaskActor, TaskPermission } from './task-actor';

interface TaskOwnership {
  createdById: string | null;
  assigneeId: string | null;
}

/**
 * Lớp 2 của phân quyền (ADR-021): quyết định cuối ở application. Bảng quyền theo role tra qua
 * `IRolePermissions`; ở đây chỉ có luật sở hữu (ADR-022, ADR-041). Không biết project archived.
 */
export class TaskPolicy {
  constructor(private readonly permissions: IRolePermissions) {}

  can(actor: TaskActor, permission: TaskPermission): boolean {
    return this.permissions.allows(actor.role, permission);
  }

  /** ADR-022: OWNER/PM mọi task; MEMBER chỉ task mình tạo (`createdById = null` ⇒ chỉ `:any`). */
  canDelete(actor: TaskActor, task: TaskOwnership): boolean {
    if (this.can(actor, 'task:delete:any')) return true;
    return (
      this.can(actor, 'task:delete:own') &&
      task.createdById !== null &&
      task.createdById === actor.userId
    );
  }

  /**
   * ADR-041 (R7) — `task:assign:own` chỉ khi: (a) task do mình tạo; (b) tự nhận task chưa có
   * người; (c) tự bỏ nhận task đang gán cho mình.
   */
  canAssign(actor: TaskActor, task: TaskOwnership, target: string | null): boolean {
    if (this.can(actor, 'task:assign:any')) return true;
    if (!this.can(actor, 'task:assign:own')) return false;
    const me = actor.userId;
    if (task.createdById !== null && task.createdById === me) return true;
    if (task.assigneeId === null && target === me) return true;
    return task.assigneeId === me && target === null;
  }

  /** Khi tạo: MEMBER chỉ để trống hoặc gán chính mình; gán người khác cần `task:assign:any`. */
  canAssignOnCreate(actor: TaskActor, assigneeId: string | null | undefined): boolean {
    if (assigneeId === null || assigneeId === undefined) return true;
    if (this.can(actor, 'task:assign:any')) return true;
    return this.can(actor, 'task:assign:own') && assigneeId === actor.userId;
  }

  /** Ném 403 kèm `details.required` (data-and-api §3.2). */
  assert(allowed: boolean, required: TaskPermission): void {
    if (!allowed) throw new ForbiddenError(required);
  }
}
