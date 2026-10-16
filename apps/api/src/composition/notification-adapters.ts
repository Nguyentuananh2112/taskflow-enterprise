import type { IUserRepository } from '../modules/auth/application/ports/user-repository.port';
import type { ILeaveReadModel } from '../modules/leave/application/ports/leave-read-model.port';
import type { ILeaveNotifier } from '../modules/leave/application/ports/leave.ports';
import type { NotificationPublisher } from '../modules/notifications';
import type {
  INotificationAudience,
  INotificationContextReader,
  LeaveSummary,
  MemberAccess,
} from '../modules/notifications/application/ports';
import type { IHrGrantNotifier } from '../modules/workspace/application/ports/collaborators.port';
import type { IWorkspaceQueries } from '../modules/workspace/application/ports/queries.port';
import type { IMembershipRepository } from '../modules/workspace/application/ports/repositories.port';

/** Chế độ bộ nhớ (dev/test): membership hiện tại từ repository InMemory của Workspace. */
export class InMemoryNotificationAudience implements INotificationAudience {
  constructor(
    private readonly ws: { queries: IWorkspaceQueries; memberships: IMembershipRepository },
  ) {}

  async workspacesOf(
    userId: string,
  ): Promise<(MemberAccess & { workspaceId: string; workspaceName: string })[]> {
    const rows = await this.ws.queries.listActiveForUser(userId);
    return rows.map((r) => ({
      userId,
      workspaceId: r.workspace.id,
      workspaceName: r.workspace.name,
      role: r.role,
      grants: r.grants,
    }));
  }

  async membersOf(workspaceId: string): Promise<MemberAccess[]> {
    const out: MemberAccess[] = [];
    for (const userId of await this.ws.memberships.listUserIds(workspaceId)) {
      const m = await this.ws.memberships.find(workspaceId, userId);
      if (m) out.push({ userId, role: m.role, grants: [...m.grants] });
    }
    return out;
  }
}

/**
 * Chế độ bộ nhớ: tên actor từ repository user của auth; tóm tắt đơn nghỉ qua reader của leave (T-039 —
 * `leaveSummaries`, chỉ loại + ngày, không `reason`). T-040b (G) sẽ thay cả lớp này bằng reader của module.
 */
export class InMemoryNotificationContextReader implements INotificationContextReader {
  constructor(
    private readonly users: IUserRepository,
    private readonly leaves: Pick<ILeaveReadModel, 'leaveSummaries'>,
  ) {}

  async actorNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const out = new Map<string, string>();
    for (const id of new Set(ids)) {
      const user = await this.users.findById(id);
      if (user) out.set(id, user.fullName);
    }
    return out;
  }

  leaveSummaries(
    refs: readonly { workspaceId: string; refId: string }[],
  ): Promise<ReadonlyMap<string, LeaveSummary>> {
    return this.leaves.leaveSummaries(refs);
  }
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
