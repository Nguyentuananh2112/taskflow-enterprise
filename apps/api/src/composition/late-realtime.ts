import type { ChatEmission, IChatTypingAccess } from '../core/realtime/chat-realtime';
import type { RealtimeGateway, RealtimeGatewayOptions } from '../core/realtime/gateway';
import {
  companyGatedSocketAuthenticator,
  socketAuthenticatorFrom,
  type CompanyGrant,
  type ISocketAuthenticator,
  type CompanyRole,
  type RealtimeEventMeta,
  type WorkspaceRole,
} from '../core/realtime/ports';

export type WorkspaceLostHook = (e: {
  workspaceId: string;
  userIds: readonly string[];
  actorId: string;
}) => Promise<void>;

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
  | 'emitChat'
>;

/**
 * Gateway Socket.io cần HTTP server (tạo từ app), còn use case trong app cần notifier ⇒ tham chiếu
 * trễ. Chưa `bind` (vd test HTTP không bật socket) ⇒ no-op: notifier chỉ chạy sau commit, best-effort.
 * Khớp `IAuthRealtimeNotifier` (auth) và `IWorkspaceRealtimeNotifier` (Workspace) theo cấu trúc.
 */
export class LateBoundRealtime implements Notifications {
  #target: Notifications | undefined;
  #onWorkspaceLost: WorkspaceLostHook | undefined;

  /**
   * Mốc 6 (T-070, TL): chat đăng ký — mất quyền workspace (bị bớt / tự rời / nghỉ việc qua WorkspaceExit / ws xóa
   * mềm) ⇒ `chat:conversation:removed` cho phòng chat của ws. Workspace vốn gọi hai hàm dưới SAU commit ⇒ không sửa
   * module workspace; lỗi của chat không ảnh hưởng event workspace (chạy sau, nuốt lỗi).
   */
  onWorkspaceAccessLost(hook: WorkspaceLostHook): void {
    this.#onWorkspaceLost = hook;
  }

  async #workspaceLost(workspaceId: string, userIds: readonly string[], meta: RealtimeEventMeta) {
    if (userIds.length === 0) return;
    await this.#onWorkspaceLost?.({ workspaceId, userIds, actorId: meta.actorId }).catch(
      () => undefined,
    );
  }

  bind(target: Notifications): void {
    this.#target = target;
  }

  disconnectSession(sid: string): Promise<void> {
    return this.#target?.disconnectSession(sid) ?? Promise.resolve();
  }

  disconnectUser(userId: string): Promise<void> {
    return this.#target?.disconnectUser(userId) ?? Promise.resolve();
  }

  async revokeWorkspaceAccess(
    input: { userId: string; workspaceId: string; projectIds: string[] },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    try {
      await this.#target?.revokeWorkspaceAccess(input, meta);
    } finally {
      await this.#workspaceLost(input.workspaceId, [input.userId], meta);
    }
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

  async closeWorkspace(
    input: { workspaceId: string; projectIds: string[]; memberUserIds: string[] },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    try {
      await this.#target?.closeWorkspace(input, meta);
    } finally {
      await this.#workspaceLost(input.workspaceId, input.memberUserIds, meta);
    }
  }

  broadcastAvatarChanged(
    input: { userId: string; avatarUrl: string | null },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    return this.#target?.broadcastAvatarChanged(input, meta) ?? Promise.resolve();
  }

  emitChat(e: ChatEmission): Promise<void> {
    return this.#target?.emitChat(e) ?? Promise.resolve();
  }
}

/** Socket chỉ cho người còn thuộc công ty (ADR-135): authenticator của auth + cổng công ty ở handshake. */
export function gatedSocketAuth(
  authenticator: Parameters<typeof socketAuthenticatorFrom>[0],
  gate: { isActive(userId: string): Promise<boolean> },
): ISocketAuthenticator {
  return companyGatedSocketAuthenticator(socketAuthenticatorFrom(authenticator), (userId) =>
    gate.isActive(userId),
  );
}

export type GatewayWiring = Pick<
  RealtimeGatewayOptions,
  'authenticator' | 'accessChecker' | 'chatTyping'
>;

export function gatewayOptions(
  authenticator: ISocketAuthenticator,
  accessChecker: RealtimeGatewayOptions['accessChecker'],
  chatTyping: IChatTypingAccess | undefined,
): GatewayWiring {
  return { authenticator, accessChecker, ...(chatTyping ? { chatTyping } : {}) };
}
