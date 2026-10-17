import { effectivePermissions } from '@taskflow/contracts';
import type { RequestHandler } from 'express';

import type { IClock, IIdGenerator } from '../core/domain';
import { ResourceNotFoundError } from '../core/errors';
import type { HttpResponder } from '../core/http/envelope';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import {
  createAttendanceModule,
  type AttendanceModule,
} from '../modules/attendance/attendance.module';
import type { ApprovedLeavePort } from '../modules/attendance/application/ports/approved-leave.port';
import type { NotificationsModule } from '../modules/notifications/notifications.module';
import type { AttendanceMembership } from '../modules/attendance/presentation/attendance-access';
import type { WorkspaceModule } from '../modules/workspace/workspace.module';
import { attendanceNotifierFrom } from './notification-adapters';
import type { Persistence } from './persistence';

// Adapter nối module attendance (T-038) với module khác qua port do attendance sở hữu (ADR-093) — chỉ composition
// root biết cả hai phía.

/** Quyền hiện tại (role ∪ grants, ADR-119) ← T-037 `WorkspaceAccess.resolveActor` (404 ⇒ không phải thành viên). */
export function attendanceMembership(
  ws: () => Pick<WorkspaceModule, 'access'>,
): AttendanceMembership {
  return {
    async permissionsOf(workspaceId, userId) {
      try {
        const actor = await ws().access.resolveActor(workspaceId, userId);
        return effectivePermissions(actor.role, actor.grants ?? []);
      } catch (err) {
        if (err instanceof ResourceNotFoundError) return null;
        throw err;
      }
    },
  };
}

/**
 * Module attendance (T-038) với adapter thật — như `wireLeave`: nhiệm kỳ / chốt ghi HR / audit ← workspace, thông báo ←
 * notifications, đơn nghỉ ← leave (tham chiếu trễ), mốc lưu ← job retention (T-047; thiếu ⇒ không áp), tên ← task/auth.
 * `clock` = giờ NGHIỆP VỤ (TEST_CLOCK_ANCHOR ở E2E).
 */
export function wireAttendance(
  d: {
    persistence: Pick<Persistence, 'attendance' | 'task' | 'uow'>;
    ids: IIdGenerator;
    clock: IClock;
    retentionCutoff?: (() => string | null) | undefined;
  },
  m: {
    workspace: WorkspaceModule;
    notifications: Pick<NotificationsModule, 'publisher'>;
    leaves: ApprovedLeavePort;
  },
  http: { responder: HttpResponder; limit: (rules: readonly RateLimitRule[]) => RequestHandler[] },
): AttendanceModule {
  return createAttendanceModule({
    repos: d.persistence.attendance,
    leaves: m.leaves,
    tenures: m.workspace.tenure,
    retention: { recordsCutoffDate: d.retentionCutoff ?? (() => null) },
    users: d.persistence.task.users,
    hrAccess: m.workspace.hrAccess,
    audit: m.workspace.hrAudit,
    notifier: attendanceNotifierFrom(m.notifications.publisher),
    membership: attendanceMembership(() => m.workspace),
    uow: d.persistence.uow,
    clock: d.clock,
    ids: d.ids,
    responder: http.responder,
    limit: http.limit,
  });
}
