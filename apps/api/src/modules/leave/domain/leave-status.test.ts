import { describe, expect, it } from 'vitest';

import { LeaveConflictError } from './leave-errors';
import {
  LEAVE_ACTIONS,
  LEAVE_STATUSES,
  LEAVE_TRANSITIONS,
  holdsBalance,
  localDate,
  nextLeaveStatus,
  type LeaveAction,
  type LeaveStatus,
} from './leave-status';

const FUTURE = { startDate: '2026-11-20', today: '2026-11-17' };
const STARTED = { startDate: '2026-11-17', today: '2026-11-17' }; // bắt đầu HÔM NAY = đã bắt đầu
const PAST = { startDate: '2026-11-10', today: '2026-11-17' };

function conflictOf(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('không ném');
}

describe('máy trạng thái đơn nghỉ (thiết kế §9, test-spec §3)', () => {
  it('LV-08/14/15: PENDING → approve / reject / cancel', () => {
    expect(nextLeaveStatus('PENDING', 'approve', FUTURE)).toBe('APPROVED');
    expect(nextLeaveStatus('PENDING', 'reject', FUTURE)).toBe('REJECTED');
    expect(nextLeaveStatus('PENDING', 'cancel', FUTURE)).toBe('CANCELLED');
  });

  it('PENDING không phụ thuộc ngày bắt đầu (duyệt/từ chối/hủy đơn đã tới ngày vẫn được)', () => {
    for (const when of [STARTED, PAST]) {
      expect(nextLeaveStatus('PENDING', 'approve', when)).toBe('APPROVED');
      expect(nextLeaveStatus('PENDING', 'reject', when)).toBe('REJECTED');
      expect(nextLeaveStatus('PENDING', 'cancel', when)).toBe('CANCELLED');
    }
  });

  it('LV-17/19: APPROVED → cancel / revoke khi startDate > hôm nay', () => {
    expect(nextLeaveStatus('APPROVED', 'cancel', FUTURE)).toBe('CANCELLED');
    expect(nextLeaveStatus('APPROVED', 'revoke', FUTURE)).toBe('REVOKED');
  });

  it('LV-18/21: APPROVED đã bắt đầu (start ≤ hôm nay) ⇒ 409 invalid_transition', () => {
    for (const action of ['cancel', 'revoke'] as const) {
      for (const when of [STARTED, PAST]) {
        const err = conflictOf(() => nextLeaveStatus('APPROVED', action, when));
        expect(err).toBeInstanceOf(LeaveConflictError);
        expect(err).toMatchObject({
          statusCode: 409,
          details: { reason: 'invalid_transition', from: 'APPROVED', action },
        });
      }
    }
  });

  it('LV-22/23: ma trận đủ 5 trạng thái × 4 hành động — mọi ô ngoài bảng ⇒ 409 invalid_transition', () => {
    const allowed = new Set([
      'PENDING:approve',
      'PENDING:reject',
      'PENDING:cancel',
      'APPROVED:cancel',
      'APPROVED:revoke',
    ]);
    for (const from of LEAVE_STATUSES) {
      for (const action of LEAVE_ACTIONS) {
        if (allowed.has(`${from}:${action}`)) continue;
        const err = conflictOf(() => nextLeaveStatus(from, action, FUTURE));
        expect(err, `${from} --${action}-->`).toMatchObject({
          statusCode: 409,
          details: { reason: 'invalid_transition', from, action },
        });
      }
    }
  });

  it('bảng chuyển công khai khớp hàm (LV-24 sẽ so bảng này với hằng trong contracts)', () => {
    const table: Record<string, string> = {};
    for (const [from, actions] of Object.entries(LEAVE_TRANSITIONS)) {
      for (const [action, to] of Object.entries(actions)) table[`${from}:${action}`] = to.to;
    }
    expect(table).toEqual({
      'PENDING:approve': 'APPROVED',
      'PENDING:reject': 'REJECTED',
      'PENDING:cancel': 'CANCELLED',
      'APPROVED:cancel': 'CANCELLED',
      'APPROVED:revoke': 'REVOKED',
    });
  });

  it('holdsBalance: chỉ PENDING (giữ chỗ) và APPROVED (đã dùng) chiếm số dư / chặn chồng ngày', () => {
    const holding: LeaveStatus[] = LEAVE_STATUSES.filter(holdsBalance);
    expect(holding).toEqual(['PENDING', 'APPROVED']);
  });

  it('kiểu hành động không hợp lệ ở runtime (chuỗi lạ) cũng ra 409, không TypeError', () => {
    expect(
      conflictOf(() => nextLeaveStatus('PENDING', 'archive' as LeaveAction, FUTURE)),
    ).toBeInstanceOf(LeaveConflictError);
  });

  it('409 mang code RESOURCE_CONFLICT + reason invalid_transition (web rẽ nhánh theo code + reason — mutation L3)', () => {
    expect(conflictOf(() => nextLeaveStatus('REJECTED', 'approve', FUTURE))).toMatchObject({
      statusCode: 409,
      code: 'RESOURCE_CONFLICT',
      details: { reason: 'invalid_transition', from: 'REJECTED', action: 'approve' },
    });
  });
});

describe('localDate — "hôm nay" theo múi giờ của lịch (D-M5, ADR-120)', () => {
  it('2026-11-16T17:30Z ở Asia/Ho_Chi_Minh đã là 17/11; ở UTC vẫn 16/11', () => {
    const now = new Date('2026-11-16T17:30:00Z');
    expect(localDate(now, 'Asia/Ho_Chi_Minh')).toBe('2026-11-17');
    expect(localDate(now, 'UTC')).toBe('2026-11-16');
  });

  it('fixture chuẩn: 2026-11-17T03:00Z = thứ Ba 17/11 giờ VN', () => {
    expect(localDate(new Date('2026-11-17T03:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-11-17');
  });

  it('múi giờ có DST (Europe/Berlin, ngày đổi giờ 25/10/2026): 23:30 giờ địa phương vẫn là 25/10', () => {
    // 25/10 sau khi lùi giờ: CET = UTC+1 ⇒ 22:30Z = 23:30 giờ Berlin.
    expect(localDate(new Date('2026-10-25T22:30:00Z'), 'Europe/Berlin')).toBe('2026-10-25');
    expect(localDate(new Date('2026-10-25T23:30:00Z'), 'Europe/Berlin')).toBe('2026-10-26');
  });
});
