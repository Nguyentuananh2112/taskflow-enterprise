import { BusinessRuleViolationError } from '../../../../core/errors';
import type { HalfDays, LeaveSpan } from '../../domain/leave-days';
import { overlaps } from '../../domain/leave-days';
import { LeaveConflictError } from '../../domain/leave-errors';
import type { LeaveRequestRecord } from '../ports/leave.ports';

/** LD-06 / D-M1: khoảng chỉ gồm ngày nghỉ / ngày lễ ⇒ không tạo đơn 0 ngày (submit + preview). */
export function assertHasWorkingDays(halfDays: HalfDays): void {
  if (halfDays === 0) {
    throw new BusinessRuleViolationError(
      'NO_WORKING_DAYS',
      'Khoảng nghỉ không có ngày làm việc nào.',
    );
  }
}

/** LV-02/04 (D-M2): chồng ô (ngày, phần) với đơn đang giữ chỗ ⇒ 409 `overlapping_leave` kèm id đơn trùng. */
export function assertNoOverlap(holding: readonly LeaveRequestRecord[], span: LeaveSpan): void {
  const clash = holding.find((r) => overlaps(r, span));
  if (clash) {
    throw new LeaveConflictError(
      'overlapping_leave',
      { requestId: clash.id },
      'Đã có đơn nghỉ trùng thời gian.',
    );
  }
}
