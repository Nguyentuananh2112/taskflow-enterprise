import type { UserRefDto } from '@taskflow/contracts';

import type { LocalDate } from '../../domain/local-time';

/**
 * Cổng sang module khác (ADR-093: module không import nội bộ của nhau) — attendance sở hữu, adapter nối ở
 * composition root. Mốc 3.5 (company-level.md ADR-136): mọi thứ thuộc CÔNG TY, không còn `workspaceId`.
 */

/**
 * Chốt cấp công ty (`CompanyAccess` của module company — khớp cấu trúc). Gọi TRONG `uow.run`, theo thứ tự khóa
 * ADR-136 (advisory trước, dòng `company_members` sau).
 * - `authorizeWrite`: khóa dòng người gọi FOR SHARE + đọc lại quyền (`hr:manage` mặc định) ⇒ 401 SESSION_REVOKED /
 *   403; tự xử lý dữ liệu của mình ⇒ 403 (luật self TUYỆT ĐỐI — Admin không có dữ liệu nhân viên). Trả role đã đọc lại.
 * - `isEmployee`: đang có dòng role EMPLOYEE.
 * - `assertActiveEmployee`: lệnh của chính nhân viên, gọi SAU khóa `punch:<user>` (A C2) ⇒ 401 khi hết quyền.
 */
export interface ICompanyAccess {
  authorizeWrite(input: {
    actorId: string;
    targetUserId?: string | null;
  }): Promise<{ role: 'ADMIN' | 'EMPLOYEE' }>;
  isEmployee(userId: string): Promise<boolean>;
  assertActiveEmployee(userId: string): Promise<void>;
}

/** Một nhiệm kỳ EMPLOYEE theo NGÀY (gồm hai đầu; `until = null` ⇒ đang làm) — ADR-133. */
export interface CompanyTenure {
  userId: string;
  from: LocalDate;
  until: LocalDate | null;
}

/**
 * Nhiệm kỳ nhân viên công ty (`ICompanyTenureReader` của module company — khớp cấu trúc): mọi nhiệm kỳ EMPLOYEE GIAO
 * `[from, to]` (ngày, gồm hai đầu) — đang làm + đã đóng (nghỉ việc / lên Admin). Bỏ `userIds` ⇒ mọi người (kể cả đã
 * nghỉ); `[]` ⇒ `[]`. Sắp theo `userId` rồi `from`.
 */
export interface ICompanyTenurePort {
  tenuresOf(q: {
    userIds?: readonly string[] | undefined;
    from: LocalDate;
    to: LocalDate;
  }): Promise<CompanyTenure[]>;
}

/** Tên hiển thị của user (`createdBy` / `voidedBy`); user ẩn danh ⇒ "Người dùng đã xóa" (auth). */
export interface IUserRefReader {
  findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, UserRefDto>>;
}

/**
 * Thông báo bền trong app (ADR-123). Ghi TRONG transaction của thay đổi nghiệp vụ; payload chỉ id + loại (không chép
 * lý do).
 */
export interface AttendanceNotifier {
  attendanceAdjusted(q: { recipientId: string; eventId: string; actorId: string }): Promise<void>;
}

/**
 * Thông báo đơn bổ sung giờ (hr-extended ADR-129) — như `ILeaveNotifier`: ghi TRONG transaction, payload chỉ id + loại
 * (KHÔNG lý do). `hr` ⇒ mọi người có `hr:manage` hiện tại + Admin, trừ actor (adapter tự mở rộng danh sách).
 */
export interface CorrectionNotifier {
  notify(input: {
    type:
      | 'CORRECTION_SUBMITTED'
      | 'CORRECTION_APPROVED'
      | 'CORRECTION_REJECTED'
      | 'CORRECTION_CANCELLED';
    requestId: string;
    actorId: string;
    recipient: { kind: 'user'; userId: string } | { kind: 'hr' };
  }): Promise<void>;
}

export type HrAuditAction =
  'EVENT_ADJUST' | 'EVENT_VOID' | 'SCHEDULE_SET' | 'HOLIDAY_SET' | 'HOLIDAY_DELETE' | 'EXPORT';

/** Mốc 5 (T-056) — enum DB thêm ở migration 8 (T-055); tách khỏi `HrAuditAction` tới khi adapter composition có đủ. */
export type CorrectionAuditAction = 'CORRECTION_SUBMIT' | 'CORRECTION_CANCEL' | 'CORRECTION_DECIDE';

/**
 * Ghi `HrAuditLog` (cấp công ty — chỉ Admin đọc): chỉ thêm, trong cùng transaction. `before`/`after` KHÔNG có khóa
 * `reason` (B-H2 — writer ném lỗi), không IP / UA (§9).
 */
export interface IHrAuditRecorder {
  record(entry: {
    actorId: string;
    action: HrAuditAction;
    targetUserId?: string | null;
    refId?: string | null;
    before?: Readonly<Record<string, unknown>> | null;
    after?: Readonly<Record<string, unknown>> | null;
  }): Promise<void>;
}

/** Audit của đơn bổ sung giờ: như `IHrAuditRecorder` (dùng được cho `appendAdjustment`) + action `CORRECTION_*`. */
export interface ICorrectionAuditRecorder {
  record(
    entry: Omit<Parameters<IHrAuditRecorder['record']>[0], 'action'> & {
      action: HrAuditAction | CorrectionAuditAction;
    },
  ): Promise<void>;
}
