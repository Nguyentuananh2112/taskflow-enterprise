// HrAuditLog (cấp công ty — company-level.md ADR-136): tập hành động chốt ở đây (domain, thuần TS — ADR-043);
// parity với `HrAuditAction` của contracts: application/hr-audit-parity.test.ts.

export const HR_AUDIT_ACTIONS = [
  'SCHEDULE_SET',
  'HOLIDAY_SET',
  'HOLIDAY_DELETE',
  'EVENT_ADJUST',
  'EVENT_VOID',
  'LEAVE_SUBMIT',
  'LEAVE_CANCEL',
  'LEAVE_DECIDE',
  'LEAVE_REVOKE',
  'BALANCE_ADJUST',
  'EXPORT',
  // Mốc 3.5 (company-level.md §3): GRANT / REVOKE theo workspace bỏ.
  'COMPANY_ROLE_SET',
  'GRANT_SET',
  'EMPLOYEE_HIRED',
  'EMPLOYEE_REHIRED',
  'EMPLOYEE_OFFBOARD_SCHEDULED',
  'EMPLOYEE_OFFBOARD_CANCELLED',
  'EMPLOYEE_OFFBOARD_COMPLETED',
  'OFFBOARD_CLEANUP',
  'ACTIVATION_LINK_ISSUED',
  'WORKSPACE_OWNER_ASSIGNED',
  'WORKSPACE_ARCHIVED',
  'COMPANY_RENAMED',
  'POLICY_SET',
  'PROFILE_SET',
  'CORRECTION_SUBMIT',
  'CORRECTION_CANCEL',
  'CORRECTION_DECIDE',
  // Mốc 6 (ADR-142): HR / Admin gỡ ảnh đại diện không phù hợp của nhân viên.
  'AVATAR_REMOVED',
  'PAYROLL_SETTINGS_SET',
  'PAYROLL_SALARY_SET',
  'PAYROLL_RUN_CREATE',
  'PAYROLL_RECALCULATE',
  'PAYROLL_ADD_MISSING',
  'PAYROLL_PAYSLIP_SET',
  'PAYROLL_PUBLISH',
  'PAYROLL_PAYSLIP_REVISE',
  'PAYROLL_PAYSLIP_VIEW',
  'PAYROLL_EXPORT',
  'COMPANY_PRIVACY_CONTACT_SET',
] as const;
export type HrAuditAction = (typeof HR_AUDIT_ACTIONS)[number];

/**
 * Khóa KHÔNG BAO GIỜ được nằm trong `before` / `after` (B-H2): lý do đơn nghỉ có thể là dữ liệu sức
 * khỏe (NĐ 13/2023). Ghi audit chỉ trạng thái / ngày / số, không chép văn bản tự do của nhân viên.
 */
export const HR_AUDIT_FORBIDDEN_KEYS = ['reason'] as const;
