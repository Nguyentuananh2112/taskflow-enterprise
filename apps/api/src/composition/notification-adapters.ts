import type { ILeaveNotifier } from '../modules/leave/application/ports/leave.ports';
import type { ILeaveSummaryReader, NotificationPublisher } from '../modules/notifications';
import type { INotificationContextReader } from '../modules/notifications/application/ports';
import type { IHrGrantNotifier } from '../modules/workspace/application/ports/collaborators.port';

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
}): INotificationContextReader {
  return {
    actorNames: async (ids) =>
      new Map([...(await d.users.findRefs(ids))].map(([id, ref]) => [id, ref.fullName])),
    leaveSummaries: (refs) => d.leaves.leaveSummaries(refs),
  };
}

// ---------------------------------------------------------------- port của module dùng (ADR-093)
// Leave (T-039): kiểu thật `ILeaveNotifier`. Attendance: chữ ký sao theo cấu trúc từ nhánh T-038
// (`attendance/application/ports/collaborators.port.ts` — AttendanceNotifier) tới khi T-038 merge.

export interface AttendanceNotifierPort {
  attendanceAdjusted(q: {
    workspaceId: string;
    recipientId: string;
    eventId: string;
    actorId: string;
  }): Promise<void>;
}

type Publisher = Pick<NotificationPublisher, 'notify'>;

/** `ILeaveNotifier` (D): `hr` ⇒ mọi người có `hr:manage` hiện tại trừ actor; `refId` = id đơn. */
export function leaveNotifierFrom(publisher: Publisher): ILeaveNotifier {
  return {
    notify: ({ workspaceId, type, requestId, actorId, recipient }) =>
      publisher.notify({ workspaceId, type, refId: requestId, actorId, recipient }),
  };
}

/** `AttendanceNotifier` (A): HR thêm / hủy lượt chấm của nhân viên ⇒ ATTENDANCE_ADJUSTED, `refId` = id lượt. */
export function attendanceNotifierFrom(publisher: Publisher): AttendanceNotifierPort {
  return {
    attendanceAdjusted: ({ workspaceId, recipientId, eventId, actorId }) =>
      publisher.notify({
        workspaceId,
        type: 'ATTENDANCE_ADJUSTED',
        refId: eventId,
        actorId,
        recipient: { kind: 'user', userId: recipientId },
      }),
  };
}

/** `IHrGrantNotifier` (Workspace, GR-04 / GR-09): cấp ⇒ HR_GRANTED, thu ⇒ HR_REVOKED; `refId` = membership. */
export function hrGrantNotifierFrom(publisher: Publisher): IHrGrantNotifier {
  return {
    grantsChanged: ({ workspaceId, userId, actorId, added, membershipId }) =>
      publisher.notify({
        workspaceId,
        type: added ? 'HR_GRANTED' : 'HR_REVOKED',
        refId: membershipId,
        actorId,
        recipient: { kind: 'user', userId },
      }),
  };
}
