import type { RealtimeEventMeta } from '../../workspace';
import type { NotificationRecord, NotificationType, VisibilityScope } from '../domain/notification';

/**
 * Bảng `notifications`. Ghi bằng `db()` của UoW ⇒ cùng transaction với thay đổi nghiệp vụ của bên gọi
 * (ADR-123). Mọi truy vấn đọc / đánh dấu nhận `VisibilityScope` — `recipientId = me` luôn nằm trong
 * WHERE (B-M3), id của người khác ⇒ không khớp ⇒ 404.
 */
export interface INotificationStore {
  addMany(records: readonly NotificationRecord[]): Promise<void>;
  /** Mới nhất trước theo `(createdAt, id)` giảm dần. Keyset: sau `after`. */
  list(
    scope: VisibilityScope,
    page: { after?: NotificationKey | undefined; limit: number },
  ): Promise<NotificationRecord[]>;
  countUnread(scope: VisibilityScope): Promise<number>;
  /** Đánh dấu một thông báo (idempotent). `false` ⇒ không tồn tại / không thấy được ⇒ 404. */
  markRead(scope: VisibilityScope, id: string, at: Date): Promise<boolean>;
  markAllRead(scope: VisibilityScope, at: Date): Promise<number>;
  /** Đã có thông báo nào `(type, refId)` (mọi người nhận) — `notifyOnce`. */
  exists(q: { type: NotificationType; refId: string }): Promise<boolean>;
}

export interface NotificationKey {
  createdAt: Date;
  id: string;
}

/**
 * Tư cách công ty HIỆN TẠI đọc từ DB (B-H3b) — do module company hiện thực (nối ở composition, ADR-093).
 * Không đọc role / grants trong access token.
 */
export interface INotificationAudience {
  /** null = không còn thuộc công ty / quá `access_until`. `since` = đầu tư cách hiện tại. */
  accessOf(
    userId: string,
  ): Promise<{ since: Date; canManageHr: boolean; canManagePayroll: boolean } | null>;
  /** Người có `hr:manage` HIỆN TẠI (Admin + nhân viên có grant HR), còn quyền — đọc trong transaction bên gọi. */
  hrRecipients(): Promise<string[]>;
  /** Người có `payroll:manage` HIỆN TẠI (Admin + nhân viên có grant Kế toán) — nhắc làm lương (T-049). */
  payrollRecipients(): Promise<string[]>;
}

export interface LeaveSummary {
  type: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
}

/**
 * Port do module LEAVE hiện thực (T-040b L2): tra theo id, chỉ loại + khoảng ngày, KHÔNG BAO GIỜ `reason`
 * (B-H2). `refIds` rỗng ⇒ Map rỗng, không query.
 */
export interface ILeaveSummaryReader {
  leaveSummaries(refIds: readonly string[]): Promise<ReadonlyMap<string, LeaveSummary>>;
}

/** Ngữ cảnh tối thiểu cho DTO. KHÔNG BAO GIỜ đọc `reason` / `decisionNote` (B-H2). */
export interface INotificationContextReader {
  actorNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Mốc 6 (ADR-142): URL ký variant 64 của người thực hiện (chỉ người còn thuộc công ty có ảnh). Thiếu ⇒ không gắn. */
  actorAvatars?(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  leaveSummaries(refIds: readonly string[]): Promise<ReadonlyMap<string, LeaveSummary>>;
  /** Kỳ lương `YYYY-MM` theo id phiếu (PAYSLIP_*) — KHÔNG số tiền. Module payroll hiện thực (T-049). */
  payslipPeriods(refIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** `notification:new` tới `user:{id}` — gateway (`UserNotifications.notification`) qua LateBoundRealtime. */
export interface INotificationRealtime {
  notifyNotification(
    input: { recipientId: string; notificationId: string; type: string },
    meta: RealtimeEventMeta,
  ): Promise<void>;
}
