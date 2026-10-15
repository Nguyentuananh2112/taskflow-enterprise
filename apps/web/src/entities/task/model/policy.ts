import type { Permission } from '@taskflow/contracts/rbac';
import type { TaskDto } from '@taskflow/contracts/task';

// Luật quyền cần ngữ cảnh tài nguyên (frontend.md §5, data-and-api R7/R9) — hàm thuần, nhận `can`
// từ usePermission(). Chỉ để ẩn/khóa UI: server vẫn là chốt chặn (lỗi 403 được xử lý êm).

export type Can = (permission: Permission) => boolean;
type TaskRef = Pick<TaskDto, 'createdBy' | 'assignee'>;

/** ADR-022: PM+ xóa mọi task; MEMBER chỉ task mình tạo (`createdBy = null` ⇒ chỉ `:any`). */
export function canDeleteTask(can: Can, viewerId: string | null, task: TaskRef): boolean {
  if (can('task:delete:any')) return true;
  return can('task:delete:own') && viewerId !== null && task.createdBy?.id === viewerId;
}

/**
 * ADR-041: đặt assignee của `task` thành `targetId`. MEMBER (`:own`) chỉ: task mình tạo; tự nhận task
 * chưa có người; tự bỏ nhận task đang gán cho mình. Người nhận phải ≥ MEMBER (ADR-044) — do picker lọc.
 */
export function canAssignTask(
  can: Can,
  viewerId: string | null,
  task: TaskRef,
  targetId: string | null,
): boolean {
  if (can('task:assign:any')) return true;
  if (!can('task:assign:own') || viewerId === null) return false;
  if (task.createdBy?.id === viewerId) return true;
  if (task.assignee === null) return targetId === viewerId;
  return task.assignee.id === viewerId && targetId === null;
}

/** Có đổi được người phụ trách sang AI ĐÓ khác hay không (để hiện picker đầy đủ). */
export function canAssignAnyone(can: Can, viewerId: string | null, task: TaskRef): boolean {
  return (
    can('task:assign:any') ||
    (can('task:assign:own') && viewerId !== null && task.createdBy?.id === viewerId)
  );
}
