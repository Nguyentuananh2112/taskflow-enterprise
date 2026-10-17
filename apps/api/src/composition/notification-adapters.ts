import type { ILeaveSummaryReader, NotificationPublisher } from '../modules/notifications';
import type { INotificationContextReader } from '../modules/notifications/application/ports';

/** Tên người dùng theo id — `IUserRefReader` (auth Prisma / bản sao InMemory của Task) dùng chung. */
export interface UserRefs {
  findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, { id: string; fullName: string }>>;
}

/**
 * Ngữ cảnh DTO thông báo (T-040b L2): notifications không đọc bảng của module khác — tên actor qua reader
 * user có sẵn, tóm tắt đơn nghỉ qua `ILeaveSummaryReader` = `readModel` của module leave (`leave.summaries`).
 */
export function notificationContextFrom(d: {
  users: UserRefs;
  leaves: ILeaveSummaryReader;
  /** Kỳ lương theo id phiếu (module payroll — T-049); thiếu ⇒ không có ngữ cảnh phiếu. */
  payslips?: { payslipPeriods(refIds: readonly string[]): Promise<ReadonlyMap<string, string>> };
}): INotificationContextReader {
  return {
    actorNames: async (ids) =>
      new Map([...(await d.users.findRefs(ids))].map(([id, ref]) => [id, ref.fullName])),
    leaveSummaries: (refIds) => d.leaves.leaveSummaries(refIds),
    payslipPeriods: (refIds) =>
      d.payslips ? d.payslips.payslipPeriods(refIds) : Promise.resolve(new Map<string, string>()),
  };
}

// ---------------------------------------------------------------- port của module dùng (ADR-093)
// Chữ ký sao THEO CẤU TRÚC từ port của leave (D, T-064 — `ILeaveNotifier`) và attendance (A, T-063 —
// `AttendanceNotifier`), cấp công ty: KHÔNG còn workspaceId (ADR-136).

type LeaveNotificationType =
  | 'LEAVE_SUBMITTED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'LEAVE_CANCELLED'
  | 'LEAVE_REVOKED'
  | 'OFFBOARD_CLEANUP';

export interface LeaveNotifierPort {
  notify(input: {
    type: LeaveNotificationType;
    /** id đơn; với OFFBOARD_CLEANUP = userId người nghỉ. */
    requestId: string;
    actorId: string;
    recipient: { kind: 'user'; userId: string } | { kind: 'hr' };
  }): Promise<void>;
}

export interface AttendanceNotifierPort {
  attendanceAdjusted(q: { recipientId: string; eventId: string; actorId: string }): Promise<void>;
}

type Publisher = Pick<NotificationPublisher, 'notify'>;

/** Leave: `hr` ⇒ mọi người có `hr:manage` hiện tại (Admin + HR) trừ actor; `refId` = id đơn. */
export function leaveNotifierFrom(publisher: Publisher): LeaveNotifierPort {
  return {
    notify: ({ type, requestId, actorId, recipient }) =>
      publisher.notify({ type, refId: requestId, actorId, recipient }),
  };
}

/** Attendance: HR thêm / hủy lượt chấm của nhân viên ⇒ ATTENDANCE_ADJUSTED, `refId` = id lượt. */
export function attendanceNotifierFrom(publisher: Publisher): AttendanceNotifierPort {
  return {
    attendanceAdjusted: ({ recipientId, eventId, actorId }) =>
      publisher.notify({
        type: 'ATTENDANCE_ADJUSTED',
        refId: eventId,
        actorId,
        recipient: { kind: 'user', userId: recipientId },
      }),
  };
}
