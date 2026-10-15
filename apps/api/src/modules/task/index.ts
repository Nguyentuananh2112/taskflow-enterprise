// Public API của module task (ADR-093): CHỈ export TYPE. Workspace (T-020) dùng `import type`
// qua file này để `implements` các port mà Task định nghĩa; hiện thực runtime wire ở composition
// root. Không export giá trị runtime (index.test.ts chặn).
export type { TaskAuditEntry, ITaskAuditLogRepository } from './application/ports/audit-log.port';
export type {
  IAssigneeDirectory,
  IRankGenerator,
  ITaskProjectStore,
  ITaskRealtimeNotifier,
  IUserRefReader,
  ProjectKey,
  ProjectRef,
  UserRef,
} from './application/ports/collaborators.port';
export type {
  IRolePermissions,
  TaskActor,
  TaskPermission,
  TaskRole,
} from './application/task-actor';
