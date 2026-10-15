import type { Permission, WorkspaceRole } from '../../workspace';

// Kiểu lấy từ public API type-only của Workspace (ADR-093): đổi role/permission bên RBAC thì
// Task không biên dịch được thay vì lệch im lặng.
export type TaskRole = WorkspaceRole;

export type TaskPermission = Extract<Permission, `task:${string}` | 'audit:read'>;

/** Người thực hiện: `role` do middleware membership nạp (security.md 3.3). Use case không đọc `req`. */
export interface TaskActor {
  userId: string;
  role: TaskRole;
}

/**
 * Tra quyền theo role. Nguồn sự thật là ma trận RBAC của module Workspace (security.md 3.2) —
 * composition root wire `roleAllows`; Task không giữ bản sao ma trận.
 */
export interface IRolePermissions {
  allows(role: TaskRole, permission: TaskPermission): boolean;
}

/** Vỏ realtime (data-and-api §4.3) — cùng hình dạng `RealtimeEventMeta` của core/realtime. */
export interface RealtimeEventMeta {
  actorId: string;
  originClientId?: string | null;
}

/** Ngữ cảnh chung của mọi lệnh/truy vấn task (test-spec §3). */
export interface TaskScope {
  workspaceId: string;
  projectId: string;
  actor: TaskActor;
  /** `X-Client-Id` đã validate (uuid hoặc null) — chỉ để gắn `originClientId`. */
  clientId?: string | null;
}
