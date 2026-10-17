import { describe, expect, it } from 'vitest';

import type { NotifyInput } from '../modules/notifications';
import { attendanceNotifierFrom, leaveNotifierFrom } from './notification-adapters';

const spy = () => {
  const calls: NotifyInput[] = [];
  return {
    calls,
    notify: (input: NotifyInput) => {
      calls.push(input);
      return Promise.resolve();
    },
  };
};

const REQ = '0000aaaa-0000-7000-8000-00000000aaaa';

describe('adapter port của leave / attendance → NotificationPublisher.notify', () => {
  it('ILeaveNotifier (T-039): requestId ⇒ refId, giữ nguyên loại / actor / recipient (user | hr)', async () => {
    const p = spy();
    const leave = leaveNotifierFrom(p);
    await leave.notify({
      type: 'LEAVE_SUBMITTED',
      requestId: REQ,
      actorId: 'mia',
      recipient: { kind: 'hr' },
    });
    await leave.notify({
      type: 'LEAVE_REVOKED',
      requestId: REQ,
      actorId: 'hana',
      recipient: { kind: 'user', userId: 'mia' },
    });
    expect(p.calls).toEqual([
      {
        type: 'LEAVE_SUBMITTED',
        refId: REQ,
        actorId: 'mia',
        recipient: { kind: 'hr' },
      },
      {
        type: 'LEAVE_REVOKED',
        refId: REQ,
        actorId: 'hana',
        recipient: { kind: 'user', userId: 'mia' },
      },
    ]);
  });

  it('AttendanceNotifier (T-038): attendanceAdjusted ⇒ ATTENDANCE_ADJUSTED tới nhân viên, refId = id lượt chấm', async () => {
    const p = spy();
    await attendanceNotifierFrom(p).attendanceAdjusted({
      recipientId: 'mia',
      eventId: REQ,
      actorId: 'hana',
    });
    expect(p.calls).toEqual([
      {
        type: 'ATTENDANCE_ADJUSTED',
        refId: REQ,
        actorId: 'hana',
        recipient: { kind: 'user', userId: 'mia' },
      },
    ]);
  });
});
