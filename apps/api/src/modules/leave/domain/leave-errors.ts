import { ConflictError, type ErrorCode } from '../../../core/errors';

/** Lý do 409 của module leave (thiết kế §9, test-spec §3) — FE rẽ nhánh theo `details.reason`. */
export type LeaveConflictReason = 'invalid_transition' | 'overlap' | 'requester_not_member';

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
