/**
 * Bối cảnh chuẩn test-spec-hr §0.2 (hằng thuần, không import gì của harness) — dùng chung cho harness
 * in-memory và backend Postgres của runner LSP.
 */
export const VN = 'Asia/Ho_Chi_Minh';
export const W1 = '0199e5a2-0000-7000-8000-0000000000a1';
export const MIA = '0199e5a2-0000-7000-8000-0000000000b1';
export const MAX = '0199e5a2-0000-7000-8000-0000000000b2';
/** MEMBER có grant HR_MANAGE (test-spec §0.2). */
export const HANA = '0199e5a2-0000-7000-8000-0000000000c1';
export const OLIVIA = '0199e5a2-0000-7000-8000-0000000000c0';
export const VIC = '0199e5a2-0000-7000-8000-0000000000b9';
export const W2 = '0199e5a2-0000-7000-8000-0000000000a2';
export const ROLES: Record<string, 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER'> = {
  [OLIVIA]: 'OWNER',
  [HANA]: 'MEMBER',
  [MIA]: 'MEMBER',
  [MAX]: 'MEMBER',
  [VIC]: 'VIEWER',
};
export const NAMES: Record<string, string> = {
  [OLIVIA]: 'Olivia',
  [HANA]: 'Hana',
  [MIA]: 'Mia',
  [MAX]: 'Max',
  [VIC]: 'Vic',
};
/** Người dùng / workspace nền mà backend Postgres phải seed (FK). */
export const FIXTURE = { workspaces: [W1, W2], users: NAMES } as const;
