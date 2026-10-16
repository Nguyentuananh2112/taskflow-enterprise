// Public API của module workspace (ADR-093; quyết định Tech Lead ở T-015): CHỈ export TYPE.
// Module khác (Task — T-018, gateway Socket.io — T-016) dùng `import type` qua file này để
// khai báo `implements` port do Workspace định nghĩa. Không export giá trị runtime
// (index.test.ts chặn) — phụ thuộc giữa module chỉ ở mức type.
export type {
  IProjectAccessChecker,
  ITaskAssignmentCleaner,
  IWorkspaceRealtimeNotifier,
  RealtimeEventMeta,
} from './application/ports/collaborators.port';
export type { Actor } from './application/workspace-shared';
export type { MemberGrant, Permission, WorkspaceRole } from './domain/roles';
