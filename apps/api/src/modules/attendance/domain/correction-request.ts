/**
 * Máy trạng thái đơn bổ sung giờ (hr-extended ADR-129): `PENDING → APPROVED | REJECTED | CANCELLED`; mọi chuyển khác ⇒
 * 409 `invalid_transition`. Ai được làm (người gửi hủy, HR khác người gửi duyệt / từ chối) kiểm ở application.
 */
export type CorrectionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type CorrectionAction = 'cancel' | 'approve' | 'reject';

const TARGET: Readonly<Record<CorrectionAction, CorrectionStatus>> = {
  cancel: 'CANCELLED',
  approve: 'APPROVED',
  reject: 'REJECTED',
};

/** Trạng thái sau `action`; `null` = chuyển không hợp lệ (chỉ PENDING mới chuyển được). */
export function nextCorrectionStatus(
  from: CorrectionStatus,
  action: CorrectionAction,
): CorrectionStatus | null {
  return from === 'PENDING' ? TARGET[action] : null;
}

/**
 * Lặp `approve` idempotent (ADR-129): đơn đã APPROVED bởi CHÍNH người duyệt này với CÙNG `expectedVersion` (lần duyệt
 * tăng version đúng 1) ⇒ trả trạng thái hiện tại, không tạo lượt mới. Người khác / version khác ⇒ `invalid_transition`.
 */
export function isApproveReplay(
  request: { status: CorrectionStatus; decidedById: string | null; version: number },
  attempt: { deciderId: string; expectedVersion: number },
): boolean {
  return (
    request.status === 'APPROVED' &&
    request.decidedById === attempt.deciderId &&
    request.version === attempt.expectedVersion + 1
  );
}
