import type { MemberGrant, RealtimeEventMeta, WorkspaceRole } from '../../workspace';
import type { NotificationRecord, VisibilityScope } from '../domain/notification';

/**
 * Bảng `notifications`. Ghi bằng `db()` của UoW ⇒ cùng transaction với thay đổi nghiệp vụ của bên gọi
 * (ADR-123). Mọi truy vấn đọc / đánh dấu nhận `VisibilityScope` — `recipientId = me` luôn nằm trong
 * WHERE (B-M3), id của người khác / ws đã rời ⇒ không khớp ⇒ 404.
 */
export interface INotificationStore {
  addMany(records: readonly NotificationRecord[]): Promise<void>;
  /**
   * Mới nhất trước theo `(createdAt, id)` giảm dần — uuid v7 trong cùng mili giây không theo thứ tự nên
   * không sắp theo id riêng; fan-out cùng `createdAt` phân định bằng id. Keyset: sau `after`.
   */
  list(
    scope: VisibilityScope,
    page: { after?: NotificationKey | undefined; limit: number },
  ): Promise<NotificationRecord[]>;
  countUnread(scope: VisibilityScope): Promise<number>;
  /** Đánh dấu một thông báo (idempotent). `false` ⇒ không tồn tại / không thấy được ⇒ 404. */
  markRead(scope: VisibilityScope, id: string, at: Date): Promise<boolean>;
  markAllRead(scope: VisibilityScope, at: Date): Promise<number>;
}

export interface NotificationKey {
  createdAt: Date;
  id: string;
}

export interface MemberAccess {
  userId: string;
  role: WorkspaceRole;
  grants: readonly MemberGrant[];
}

export interface AudienceWorkspace extends MemberAccess {
  workspaceId: string;
  workspaceName: string;
  /** `workspace_members.joined_at` — đầu nhiệm kỳ hiện tại (T-040b). */
  joinedAt: Date;
}

/** Membership HIỆN TẠI đọc từ DB (B-H3b) — không đọc role/grants trong access token. */
export interface INotificationAudience {
  /** Workspace CHƯA xóa mà user đang là thành viên, kèm tên + role + grants + đầu nhiệm kỳ hiện tại. */
  workspacesOf(userId: string): Promise<AudienceWorkspace[]>;
  /** Mọi thành viên của ws (fan-out tới người có `hr:manage` — lọc ở application bằng cùng hàm quyền). */
  membersOf(workspaceId: string): Promise<MemberAccess[]>;
}

export interface LeaveSummary {
  type: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
}

/** Ngữ cảnh tối thiểu cho DTO (góp ý E). KHÔNG BAO GIỜ đọc `reason` / `decisionNote` (B-H2). */
export interface INotificationContextReader {
  actorNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Tra theo cặp (ws, id) — đơn của ws khác không bao giờ khớp. */
  leaveSummaries(
    refs: readonly { workspaceId: string; refId: string }[],
  ): Promise<ReadonlyMap<string, LeaveSummary>>;
}

/** `notification:new` tới `user:{id}` — gateway (`UserNotifications.notification`) qua LateBoundRealtime. */
export interface INotificationRealtime {
  notifyNotification(
    input: { recipientId: string; notificationId: string; type: string; workspaceId: string },
    meta: RealtimeEventMeta,
  ): Promise<void>;
}

/** Quyền hiệu lực có `hr:manage` (ADR-119) — composition root nối `effectivePermissions` của contracts. */
export type CanManageHr = (role: WorkspaceRole, grants: readonly MemberGrant[]) => boolean;
