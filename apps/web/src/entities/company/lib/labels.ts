import type { CompanyGrant, EmployeeStatus } from '@taskflow/contracts/company';

/** Trạng thái nhân viên bằng lời thường (ADR-133 trạng thái suy ra). */
export const EMPLOYEE_STATUS_LABEL: Readonly<Record<EmployeeStatus, string>> = {
  PENDING_ACTIVATION: 'Chờ kích hoạt',
  ACTIVE: 'Đang làm',
  OFFBOARDING: 'Sắp nghỉ',
  LEFT: 'Đã nghỉ',
};

export const GRANT_LABEL: Readonly<Record<CompanyGrant, string>> = {
  HR_MANAGE: 'Quản lý nhân sự',
  PAYROLL_MANAGE: 'Kế toán (lương)',
};
