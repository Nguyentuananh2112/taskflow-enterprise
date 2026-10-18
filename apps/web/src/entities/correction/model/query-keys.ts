import type { CorrectionStatus } from '@taskflow/contracts/attendance';

// Đơn của mình: dưới ['company','attendance'] (cùng vòng đời bảng công của mình). Hàng chờ HR: dưới ['company','hr']
// ⇒ mất `hr:manage` thì bị xóa cùng dữ liệu nhân sự (`company:access-changed`).
export const correctionKeys = {
  mine: () => ['company', 'attendance', 'corrections'] as const,
  hrAll: () => ['company', 'hr', 'corrections'] as const,
  hr: (status: CorrectionStatus | 'ALL') => ['company', 'hr', 'corrections', status] as const,
  hrPendingCount: () => ['company', 'hr', 'corrections', 'pending-count'] as const,
};
