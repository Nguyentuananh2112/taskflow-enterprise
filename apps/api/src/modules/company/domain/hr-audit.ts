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
] as const;
export type HrAuditAction = (typeof HR_AUDIT_ACTIONS)[number];

/**
 * Khóa KHÔNG BAO GIỜ được nằm trong `before` / `after` (B-H2): lý do đơn nghỉ có thể là dữ liệu sức
 * khỏe (NĐ 13/2023). Ghi audit chỉ trạng thái / ngày / số, không chép văn bản tự do của nhân viên.
 */
export const HR_AUDIT_FORBIDDEN_KEYS = ['reason'] as const;
