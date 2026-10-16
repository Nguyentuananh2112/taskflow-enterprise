import { AppError, ConflictError, type ErrorCode } from '../../../core/errors';

/** Lý do 409 của module leave (thiết kế §9, test-spec §3) — FE rẽ nhánh theo `details.reason`. */
export type LeaveConflictReason =
  'invalid_transition' | 'overlapping_leave' | 'requester_not_member';

/**
 * 409 của đơn nghỉ. Dùng lại mã `RESOURCE_CONFLICT` (không thêm mã vào contracts) — giống `ResourceConflictError`
 * nhưng `details` mang thêm ngữ cảnh (`from`, `action`…) có kiểu. Xung đột `version` vẫn là `VersionConflictError`.
 */
export class LeaveConflictError extends ConflictError {
  readonly code: ErrorCode = 'RESOURCE_CONFLICT';

  constructor(
    reason: LeaveConflictReason,
    extra: Readonly<Record<string, unknown>> = {},
    message = 'Thao tác xung đột với trạng thái hiện tại của đơn nghỉ.',
  ) {
    super(message, { ...extra, reason });
  }
}

/**
 * 404 đơn nghỉ — cùng hình dạng `RESOURCE_NOT_FOUND` (ADR-020: không tồn tại / ws khác / đơn của người khác với
 * nhân viên thường đều như nhau). `details.resource = 'leave_request'`: thêm vào enum `resource` của contracts
 * cùng đợt danh sách reason/rule leave (sau T-037 — TL).
 */
export class LeaveNotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code: ErrorCode = 'RESOURCE_NOT_FOUND';

  constructor(message = 'Không tìm thấy đơn nghỉ.') {
    super(message, { resource: 'leave_request' });
  }
}
