// Hằng bối cảnh test payroll — TÁCH khỏi harness: backend Prisma của integration (LSP) import được mà không vòng qua
// module harness đang bị `vi.mock` (factory import backend ⇒ backend import harness ⇒ treo).

/** Bối cảnh chuẩn (payroll.md §7): Kai Kế toán, Olivia Admin (không có phiếu), Mia / Max nhân viên. */
export const KAI = '0199e5a2-0000-7000-8000-00000000a001';
export const OLIVIA = '0199e5a2-0000-7000-8000-00000000a000';
export const MIA = '0199e5a2-0000-7000-8000-00000000b001';
export const MAX = '0199e5a2-0000-7000-8000-00000000b002';
export const NAMES: Record<string, string> = {
  [KAI]: 'Kai',
  [OLIVIA]: 'Olivia',
  [MIA]: 'Mia',
  [MAX]: 'Max',
};

/** Ngày đầu tháng 12/2026 10:00 giờ VN — kỳ 2026-11 đã kết thúc. */
export const NOW = '2026-12-01T03:00:00.000Z';
