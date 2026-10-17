import type { EmployeeDto, EmployeeStatus } from '@taskflow/contracts/company';

import type { MockDb } from './mock-db';

// Dựng EmployeeDto / cảnh báo nghỉ việc từ trạng thái mock (tách khỏi employee-handlers cho gọn).

/** `withAdmin`: chỉ cho lệnh cho nghỉ việc (Admin cũng nghỉ được — B T-062); danh sách KHÔNG có Admin. */
export function toEmployee(
  db: MockDb,
  userId: string,
  today: string,
  withAdmin = false,
): EmployeeDto | undefined {
  const company = db.company;
  const user = db.getUser(userId);
  if (!user) return undefined;
  const row = company.row(userId);
  if (row?.role === 'ADMIN' && !withAdmin) return undefined; // Admin không phải nhân viên (ADR-134)
  const left = !row && company.departures.has(userId);
  if (!row && !left) return undefined;
  const status: EmployeeStatus = !row
    ? 'LEFT'
    : user.password === ''
      ? 'PENDING_ACTIVATION'
      : row.offboardLastDay
        ? 'OFFBOARDING'
        : 'ACTIVE';
  return {
    userId,
    fullName: user.fullName,
    email: user.email,
    status,
    grants: row ? [...row.grants] : [],
    startDate: row?.startDate ?? null,
    offboardLastDay:
      row?.offboardLastDay ?? (left ? (company.departures.get(userId)?.lastDay ?? null) : null),
    version: row?.version ?? null,
    ...company.profiles.summary(userId, today),
  };
}

/** Workspace mà người này là OWNER DUY NHẤT ⇒ sẽ mồ côi khi nghỉ việc (cảnh báo của PUT offboarding). */
export function soleOwnerWorkspacesOf(
  db: MockDb,
  userId: string,
): Array<{ id: string; name: string }> {
  return db.workspaces
    .activeOf(userId)
    .filter(({ workspace, member }) => {
      const owners = db.workspaces.membersOf(workspace.id).filter((m) => m.role === 'OWNER');
      return member.role === 'OWNER' && owners.length === 1;
    })
    .map(({ workspace }) => ({ id: workspace.id, name: workspace.name }));
}
