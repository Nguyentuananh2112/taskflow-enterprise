import {
  effectiveCompanyPermissions,
  type CompanyGrant,
  type CompanyRole,
  type UserRefDto,
} from '@taskflow/contracts';

import type { IClock } from '../core/domain';
import type {
  EmployeeKey,
  ILeaveEmployeeDirectory,
} from '../modules/leave/application/ports/leave-read-model.port';
import type {
  HrAuditAction,
  IHrAudit,
  ILeaveCompany,
  LeaveActor,
} from '../modules/leave/application/ports/leave.ports';
import type { LeaveTenure } from '../modules/leave/domain/leave-tenure';
import type { InMemoryLeaveRepository } from '../modules/leave/infrastructure/persistence/in-memory/in-memory-leave.repository';
import type { DbProvider } from '../modules/leave/infrastructure/persistence/prisma/db';
import { PrismaLeaveEmployeeDirectory } from '../modules/leave/infrastructure/persistence/prisma/prisma-leave-employee-directory';
import { PrismaLeaveReadModel } from '../modules/leave/infrastructure/persistence/prisma/prisma-leave-read-model';
import { PrismaLeaveRepository } from '../modules/leave/infrastructure/persistence/prisma/prisma-leave.repository';
import type { LeaveRepositories } from '../modules/leave/leave.module';

// Adapter nối module leave (T-039/T-064) với module khác qua port do leave sở hữu (ADR-093) — chỉ composition root
// biết cả hai phía. Kiểu phía company khai theo CẤU TRÚC (khớp `CompanyAccess`, `ICompanyMemberRepository`,
// `ICompanyTenureReader` của T-061) để leave không phụ thuộc thứ tự merge.

/** Dòng `company_members` mà leave cần (`CompanyMemberSnapshot` của company). */
interface CompanyMemberView {
  userId: string;
  role: CompanyRole;
  grants: readonly CompanyGrant[];
  startDate: string | null;
  offboardLastDay: string | null;
  offboardAccessUntil: Date | null;
}

export interface CompanyPortsForLeave {
  access: {
    authorizeWrite(input: {
      actorId: string;
      permission?: string;
      targetUserId?: string | null;
    }): Promise<{ userId: string; role: CompanyRole; grants: readonly CompanyGrant[] }>;
    isEmployee(userId: string): Promise<boolean>;
    assertActiveEmployee(userId: string): Promise<void>;
  };
  members: { find(userId: string): Promise<CompanyMemberView | null> };
  tenures: {
    tenuresOf(query: {
      userIds?: readonly string[];
      from: string;
      to: string;
    }): Promise<{ userId: string; from: string; until: string | null }[]>;
  };
  clock: IClock;
}

const toLeaveActor = (a: {
  userId: string;
  role: CompanyRole;
  grants: readonly CompanyGrant[];
}): LeaveActor => ({
  userId: a.userId,
  role: a.role,
  permissions: effectiveCompanyPermissions(a.role, a.grants),
});

/** Quyền / nhân viên / nhiệm kỳ ← company (T-061 `CompanyAccess` + repository + tenure reader). */
export function leaveCompanyFrom(c: () => CompanyPortsForLeave): ILeaveCompany {
  return {
    async reloadActor(userId) {
      const m = await c().members.find(userId);
      const now = c().clock.now().getTime();
      if (!m || (m.offboardAccessUntil !== null && now >= m.offboardAccessUntil.getTime())) {
        return null;
      }
      return toLeaveActor(m);
    },
    async authorizeHrWrite({ actorId, targetUserId }) {
      // Luật self tuyệt đối (company-level ADR-134/135) — lý do quản trị không đổi kết quả, chỉ vào audit.
      return toLeaveActor(
        await c().access.authorizeWrite({ actorId, permission: 'hr:manage', targetUserId }),
      );
    },
    assertActiveEmployee: (userId) => c().access.assertActiveEmployee(userId),
    isEmployee: (userId) => c().access.isEmployee(userId),
    async employmentOf(userId) {
      const m = await c().members.find(userId);
      return {
        current:
          m?.role === 'EMPLOYEE' && m.startDate !== null
            ? { from: m.startDate, until: null }
            : null,
        lastDay: m?.offboardLastDay ?? null,
      };
    },
    async tenuresOf({ userIds, from, to }) {
      const out = new Map<string, LeaveTenure[]>();
      if (userIds.length === 0) return out;
      for (const t of await c().tenures.tenuresOf({ userIds, from, to })) {
        const list = out.get(t.userId) ?? [];
        list.push({ from: t.from, until: t.until });
        out.set(t.userId, list);
      }
      return out;
    },
  };
}

/** Bộ ghi HrAuditLog cấp công ty (`HrAuditWriter` của company — chặn `reason` trong before/after). */
export interface HrAuditWriterForLeave {
  record(input: {
    actorId: string;
    action: HrAuditAction;
    targetUserId?: string | null;
    refId?: string | null;
    before?: Readonly<Record<string, unknown>> | null;
    after?: Readonly<Record<string, unknown>> | null;
  }): Promise<void>;
}

/**
 * Lý do QUẢN TRỊ (`note`: thu hồi, chỉnh số dư, dọn đơn khi nghỉ việc, nhận lại) không có cột riêng ⇒ ghi vào
 * `after.note` (B — không bao giờ là `reason` của đơn); trim, rỗng ⇒ không có khóa.
 */
export function leaveAudit(writer: () => HrAuditWriterForLeave): IHrAudit {
  return {
    record: ({ note, after, ...rest }) => {
      const adminNote = note?.trim() ?? '';
      return writer().record({
        ...rest,
        after: adminNote === '' ? after : { ...(after ?? {}), note: adminNote },
      });
    },
  };
}

/**
 * Danh bạ nhân viên cho chế độ BỘ NHỚ (local/test) — nhận toàn bộ nhân viên (role EMPLOYEE) từ company rồi sắp
 * (tên, id) + keyset. Prisma dùng `PrismaLeaveEmployeeDirectory` (một truy vấn keyset).
 */
export class ListEmployeeDirectory implements ILeaveEmployeeDirectory {
  constructor(private readonly employees: () => Promise<UserRefDto[]>) {}

  async listEmployees(after: EmployeeKey | null, limit: number): Promise<UserRefDto[]> {
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
    return (await this.employees())
      .sort(cmp)
      .filter((u) => after === null || cmp(u, after) > 0)
      .slice(0, limit);
  }
}

/** Lưu trữ leave chế độ bộ nhớ: một repo làm cả ghi lẫn đọc; nhân viên từ company. */
export function memoryLeaveRepositories(
  store: InMemoryLeaveRepository,
  employees: () => Promise<UserRefDto[]>,
): LeaveRepositories {
  return { requests: store, readModel: store, employees: new ListEmployeeDirectory(employees) };
}

/** Lưu trữ leave Prisma — cùng `db` (một transaction) với các module khác. */
export function prismaLeaveRepositories(db: DbProvider): LeaveRepositories {
  return {
    requests: new PrismaLeaveRepository(db),
    readModel: new PrismaLeaveReadModel(db),
    employees: new PrismaLeaveEmployeeDirectory(db),
  };
}
