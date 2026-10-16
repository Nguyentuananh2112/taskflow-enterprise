// HrAuditLog (Mốc 3, attendance-leave.md §3): tập hành động chốt ở đây (domain, thuần TS — ADR-043);
// parity với `HrAuditAction` của contracts: application/hr-audit-parity.test.ts.

export const HR_AUDIT_ACTIONS = [
  'GRANT',
  'REVOKE',
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
] as const;
export type HrAuditAction = (typeof HR_AUDIT_ACTIONS)[number];

/**
 * Khóa KHÔNG BAO GIỜ được nằm trong `before` / `after` (B-H2): lý do đơn nghỉ có thể là dữ liệu sức
 * khỏe (NĐ 13/2023). Ghi audit chỉ trạng thái / ngày / số, không chép văn bản tự do của nhân viên.
 */
export const HR_AUDIT_FORBIDDEN_KEYS = ['reason'] as const;
