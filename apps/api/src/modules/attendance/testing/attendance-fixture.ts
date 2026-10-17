/**
 * Bối cảnh chuẩn test-spec-hr §0.2 — cấp CÔNG TY (company-level ADR-133/136): một công ty, một bộ lịch. Hằng thuần,
 * không import gì của harness — dùng chung cho harness in-memory và backend Postgres của runner LSP.
 */
export const VN = 'Asia/Ho_Chi_Minh';
export const MIA = '0199e5a2-0000-7000-8000-0000000000b1';
export const MAX = '0199e5a2-0000-7000-8000-0000000000b2';
/** Nhân viên có grant HR_MANAGE. */
export const HANA = '0199e5a2-0000-7000-8000-0000000000c1';
/** Admin — KHÔNG phải nhân viên (không chấm công, không có trong bảng công — ADR-134). */
export const OLIVIA = '0199e5a2-0000-7000-8000-0000000000c0';
/** Nhân viên thường thứ hai (trước Mốc 3.5 là VIEWER của workspace — vai trò dự án không còn liên quan). */
export const VIC = '0199e5a2-0000-7000-8000-0000000000b9';
export const ROLES: Record<string, 'ADMIN' | 'EMPLOYEE'> = {
  [OLIVIA]: 'ADMIN',
  [HANA]: 'EMPLOYEE',
  [MIA]: 'EMPLOYEE',
  [MAX]: 'EMPLOYEE',
  [VIC]: 'EMPLOYEE',
};
/** Người có `hr:manage` (Admin ngầm có). */
export const HR_MANAGERS: ReadonlySet<string> = new Set([OLIVIA, HANA]);
export const NAMES: Record<string, string> = {
  [OLIVIA]: 'Olivia',
  [HANA]: 'Hana',
  [MIA]: 'Mia',
  [MAX]: 'Max',
  [VIC]: 'Vic',
};
/** Người dùng nền mà backend Postgres phải seed (FK). */
export const FIXTURE = { users: NAMES } as const;
