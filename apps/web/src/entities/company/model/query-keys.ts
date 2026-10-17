import type { ListEmployeesQuery } from '@taskflow/contracts/company';

// Dưới gốc ['company'] (ADR-139) — đăng xuất / SESSION_REVOKED ⇒ `queryClient.clear()`; mất quyền ⇒ xóa nhánh.
export const companyKeys = {
  employees: () => ['company', 'hr', 'employees'] as const,
  employeeList: (q: Pick<ListEmployeesQuery, 'status' | 'q'>) =>
    ['company', 'hr', 'employees', q.status ?? 'current', q.q ?? ''] as const,
  admin: () => ['company', 'admin'] as const,
  access: () => ['company', 'admin', 'access'] as const,
  workspaces: () => ['company', 'admin', 'workspaces'] as const,
  info: () => ['company', 'info'] as const,
};
