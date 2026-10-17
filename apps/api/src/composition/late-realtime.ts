import type { RealtimeGateway } from '../core/realtime/gateway';
import type {
  CompanyGrant,
  CompanyRole,
  RealtimeEventMeta,
  WorkspaceRole,
} from '../core/realtime/ports';

type Notifications = Pick<
  RealtimeGateway,
  | 'disconnectSession'
  | 'disconnectUser'
  | 'revokeWorkspaceAccess'
  | 'notifyRoleChanged'
  | 'notifyCompanyAccessChanged'
  | 'notifyNotification'
  | 'closeWorkspace'
  | 'emitToProject'
  | 'broadcastAvatarChanged'
>;

/**
 * Gateway Socket.io cần HTTP server (tạo từ app), còn use case trong app cần notifier ⇒ tham chiếu
 * trễ. Chưa `bind` (vd test HTTP không bật socket) ⇒ no-op: notifier chỉ chạy sau commit, best-effort.
 * Khớp `IAuthRealtimeNotifier` (auth) và `IWorkspaceRealtimeNotifier` (Workspace) theo cấu trúc.
 */
export class LateBoundRealtime implements Notifications {
  #target: Notifications | undefined;

  bind(target: Notifications): void {
    this.#target = target;
  }

  disconnectSession(sid: string): Promise<void> {
    return this.#target?.disconnectSession(sid) ?? Promise.resolve();
  }

  disconnectUser(userId: string): Promise<void> {
    return this.#target?.disconnectUser(userId) ?? Promise.resolve();
  }

  revokeWorkspaceAccess(
    input: { userId: string; workspaceId: string; projectIds: string[] },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    return this.#target?.revokeWorkspaceAccess(input, meta) ?? Promise.resolve();
  }

  notifyRoleChanged(
    input: { userId: string; workspaceId: string; role: WorkspaceRole },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    return this.#target?.notifyRoleChanged(input, meta) ?? Promise.resolve();
  }

  notifyCompanyAccessChanged(
    input: { userId: string; role: CompanyRole; grants: readonly CompanyGrant[] },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    return this.#target?.notifyCompanyAccessChanged(input, meta) ?? Promise.resolve();
  }

  notifyNotification(
    input: { recipientId: string; notificationId: string; type: string },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    return this.#target?.notifyNotification(input, meta) ?? Promise.resolve();
  }

  /** Event `task:*` (port `ITaskRealtimeNotifier` của Task) — payload do use case dựng sẵn. */
  emitToProject(
    input: { projectId: string; type: string; data: unknown },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    return this.#target?.emitToProject(input, meta) ?? Promise.resolve();
  }

  closeWorkspace(
    input: { workspaceId: string; projectIds: string[]; memberUserIds: string[] },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    return this.#target?.closeWorkspace(input, meta) ?? Promise.resolve();
  }

  broadcastAvatarChanged(
    input: { userId: string; avatarUrl: string | null },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    return this.#target?.broadcastAvatarChanged(input, meta) ?? Promise.resolve();
  }
}
