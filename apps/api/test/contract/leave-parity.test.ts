import {
  BusinessRule,
  HrAuditAction,
  HrConflictReason,
  LeaveDayPart,
  LeaveStatus,
  LeaveType,
  NotificationType,
} from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import type {
  HrAuditAction as LeaveAuditAction,
  LeaveNotificationType,
} from '../../src/modules/leave/application/ports/leave.ports';
import { LEAVE_TYPES } from '../../src/modules/leave/domain/leave-balance';
import type { LeaveConflictReason } from '../../src/modules/leave/domain/leave-errors';
import { LEAVE_STATUSES } from '../../src/modules/leave/domain/leave-status';

/**
 * Domain giữ hằng RIÊNG (ADR-043: domain không phụ thuộc contracts lúc chạy) ⇒ test này giữ hai bên khớp
 * (cùng tinh thần ADR-080). Thêm/đổi giá trị ở một bên mà quên bên kia ⇒ đỏ.
 */
describe('leave domain ↔ @taskflow/contracts (parity)', () => {
  it('LeaveStatus / LeaveType / LeaveDayPart trùng khớp tuyệt đối', () => {
    expect([...LEAVE_STATUSES]).toEqual(LeaveStatus.options);
    expect([...LEAVE_TYPES]).toEqual(LeaveType.options);
    const dayParts: readonly string[] = ['FULL', 'AM', 'PM'] satisfies readonly LeaveDayPart[];
    expect([...dayParts]).toEqual(LeaveDayPart.options);
  });

  it('reason 409 của leave ⊂ HrConflictReason', () => {
    const reasons: LeaveConflictReason[] = [
      'invalid_transition',
      'overlapping_leave',
      'requester_not_member',
    ];
    for (const r of reasons) expect(HrConflictReason.options).toContain(r);
  });

  it('rule 422 leave dùng ⊂ BusinessRule', () => {
    for (const r of [
      'INSUFFICIENT_BALANCE',
      'NO_WORKING_DAYS',
      'LEAVE_SPANS_YEARS',
      'REASON_REQUIRED',
    ]) {
      expect(BusinessRule.options).toContain(r);
    }
  });

  it('hành động audit và loại thông báo leave ⊂ contracts', () => {
    const actions: LeaveAuditAction[] = [
      'LEAVE_SUBMIT',
      'LEAVE_CANCEL',
      'LEAVE_DECIDE',
      'LEAVE_REVOKE',
      'BALANCE_ADJUST',
    ];
    for (const a of actions) expect(HrAuditAction.options).toContain(a);
    const types: LeaveNotificationType[] = [
      'LEAVE_SUBMITTED',
      'LEAVE_APPROVED',
      'LEAVE_REJECTED',
      'LEAVE_CANCELLED',
      'LEAVE_REVOKED',
    ];
    for (const t of types) expect(NotificationType.options).toContain(t);
  });
});
