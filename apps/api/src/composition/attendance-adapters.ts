import { effectivePermissions } from '@taskflow/contracts';

import { ResourceNotFoundError } from '../core/errors';
import type { AttendanceMembership } from '../modules/attendance/presentation/attendance-access';
import type { WorkspaceModule } from '../modules/workspace/workspace.module';

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
