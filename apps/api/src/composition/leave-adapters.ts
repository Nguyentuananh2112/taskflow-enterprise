import { effectivePermissions, type UserRefDto } from '@taskflow/contracts';

import { ResourceNotFoundError } from '../core/errors';
import type {
  EmployeeKey,
  ILeaveEmployeeDirectory,
} from '../modules/leave/application/ports/leave-read-model.port';
import type {
  IHrAudit,
  ILeaveMembership,
  IWorkCalendarPort,
  LeaveActor,
  WorkCalendarDay,
} from '../modules/leave/application/ports/leave.ports';
import type { InMemoryLeaveRepository } from '../modules/leave/infrastructure/persistence/in-memory/in-memory-leave.repository';
import type { DbProvider } from '../modules/leave/infrastructure/persistence/prisma/db';
import { PrismaLeaveEmployeeDirectory } from '../modules/leave/infrastructure/persistence/prisma/prisma-leave-employee-directory';
import { PrismaLeaveReadModel } from '../modules/leave/infrastructure/persistence/prisma/prisma-leave-read-model';
import { PrismaLeaveRepository } from '../modules/leave/infrastructure/persistence/prisma/prisma-leave.repository';
import type { LeaveRepositories } from '../modules/leave/leave.module';
import type { IWorkspaceQueries } from '../modules/workspace/application/ports/queries.port';
import type { WorkspaceModule } from '../modules/workspace/workspace.module';

// Adapter nối module leave (T-039) với module khác qua port do leave sở hữu (ADR-093) — chỉ composition root biết
// cả hai phía.

type HrPorts = Pick<WorkspaceModule, 'access' | 'hrAccess' | 'hrAudit'>;

const toLeaveActor = (a: {
  userId: string;
  role: LeaveActor['role'];
  grants?: readonly 'HR_MANAGE'[] | undefined;
}): LeaveActor => ({
  userId: a.userId,
  role: a.role,
  permissions: effectivePermissions(a.role, a.grants ?? []),
});

/** Membership + chốt ghi HR ← T-037 (`WorkspaceAccess.resolveActor`, `HrAccess.authorizeWrite` / `isEmployee`). */
export function leaveMembership(ws: () => HrPorts): ILeaveMembership {
  return {
    async reloadActor(workspaceId, userId) {
      try {
        return toLeaveActor(await ws().access.resolveActor(workspaceId, userId));
      } catch (err) {
        if (err instanceof ResourceNotFoundError) return null;
        throw err;
      }
    },
    async authorizeHrWrite(input) {
      return toLeaveActor(await ws().hrAccess.authorizeWrite(input));
    },
    isEligibleRequester: (workspaceId, userId) => ws().hrAccess.isEmployee({ workspaceId, userId }),
  };
}

/**
 * HrAuditLog ← T-037 `HrAuditWriter` (chặn `reason` trong before/after). Lý do QUẢN TRỊ (`note`: OWNER tự xử lý,
 * thu hồi, chỉnh số dư) không có cột riêng ⇒ ghi vào `after.note` — không phải lý do nghỉ.
 */
export function leaveAudit(ws: () => HrPorts): IHrAudit {
  return {
    record: ({ note, after, ...rest }) => {
      // `note` CHỈ là lý do của người quản trị trong lệnh này (B) — không bao giờ là `reason` của đơn. Trim; rỗng ⇒
      // không ghi khóa. Độ dài ≤ 500 đã chặn ở contracts (như decision_note).
      const adminNote = note?.trim() ?? '';
      return ws().hrAudit.record({
        ...rest,
        after: adminNote === '' ? after : { ...(after ?? {}), note: adminNote },
      });
    },
  };
}

/**
 * TẠM tới khi A nối adapter `WorkCalendarPort` của attendance (T-038): lịch mặc định của thiết kế (T2–T7 làm, CN
 * nghỉ, 'Asia/Ho_Chi_Minh', không ngày lễ) — trùng `DEFAULT_SCHEDULE` khi workspace chưa đặt lịch.
 */
export const defaultLeaveCalendar: IWorkCalendarPort = {
  workingDays({ from, to }) {
    const days: WorkCalendarDay[] = [];
    const end = new Date(`${to}T00:00:00Z`).getTime();
    for (
      const d = new Date(`${from}T00:00:00Z`);
      d.getTime() <= end;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      days.push({
        date: d.toISOString().slice(0, 10),
        isWorkday: d.getUTCDay() !== 0,
        isHoliday: false,
        schedule: { timezone: 'Asia/Ho_Chi_Minh' },
      });
    }
    return Promise.resolve(days);
  },
};

/**
 * Danh bạ nhân viên cho chế độ BỘ NHỚ (local/test) — đọc hết thành viên qua `IWorkspaceQueries.listMembers` rồi lọc
 * VIEWER, sắp (tên, id). Prisma dùng `PrismaLeaveEmployeeDirectory` (một truy vấn keyset).
 */
export class MemberListEmployeeDirectory implements ILeaveEmployeeDirectory {
  constructor(private readonly queries: Pick<IWorkspaceQueries, 'listMembers'>) {}

  async listEmployees(
    workspaceId: string,
    after: EmployeeKey | null,
    limit: number,
  ): Promise<UserRefDto[]> {
    const all: UserRefDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.queries.listMembers(workspaceId, null, { after: cursor, limit: 100 });
      for (const m of page.items) {
        if (m.role !== 'VIEWER') all.push({ id: m.userId, fullName: m.fullName });
      }
      cursor = page.nextAfter ?? undefined;
    } while (cursor !== undefined);
    const cmp = (x: EmployeeKey, y: EmployeeKey) =>
      x.fullName < y.fullName
        ? -1
        : x.fullName > y.fullName
          ? 1
          : x.id < y.id
            ? -1
            : x.id > y.id
              ? 1
              : 0;
    return all
      .sort(cmp)
      .filter((u) => after === null || cmp(u, after) > 0)
      .slice(0, limit);
  }
}

/** Lưu trữ leave chế độ bộ nhớ: một repo làm cả ghi lẫn đọc; nhân viên đọc qua truy vấn workspace. */
export function memoryLeaveRepositories(
  store: InMemoryLeaveRepository,
  queries: Pick<IWorkspaceQueries, 'listMembers'>,
): LeaveRepositories {
  return { requests: store, readModel: store, employees: new MemberListEmployeeDirectory(queries) };
}

/** Lưu trữ leave Prisma — cùng `db` (một transaction) với các module khác. */
export function prismaLeaveRepositories(db: DbProvider): LeaveRepositories {
  return {
    requests: new PrismaLeaveRepository(db),
    readModel: new PrismaLeaveReadModel(db),
    employees: new PrismaLeaveEmployeeDirectory(db),
  };
}
