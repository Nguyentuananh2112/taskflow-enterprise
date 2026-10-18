import { NotificationDto } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { HR_AUDIENCE_TYPES, isVisible, PAYROLL_AUDIENCE_TYPES } from '../domain/notification';
import { createNotificationHarness, U } from '../testing/notification-harness';

// T-049 (payroll.md §6, B/TL chốt): nhắc làm lương tới người có `payroll:manage` HIỆN TẠI (như B-H3b của HR); thông báo
// phiếu lương có ngữ cảnh `payslip.period` (join theo id phiếu, KHÔNG số tiền).
const RUN = '0000cccc-0000-7000-8000-00000000cccc';
const SLIP = '0000dddd-0000-7000-8000-00000000dddd';

function withAccountant() {
  const h = createNotificationHarness();
  h.audience.set(U.max, false, true); // Max: nhân viên + grant Kế toán
  h.audience.set(U.olivia, true, true); // Admin: có cả hr:manage lẫn payroll:manage
  return h;
}

describe('PAYROLL_REMINDER — người nhận + hiển thị theo payroll:manage hiện tại', () => {
  it('recipient `payroll` ⇒ đúng người có payroll:manage (Admin + Kế toán), trừ actor; HR thường không nhận', async () => {
    const h = withAccountant();
    await h.notifyInTx({
      type: 'PAYROLL_REMINDER',
      refId: RUN,
      actorId: U.pam,
      recipient: { kind: 'payroll' },
    });
    expect((await h.queries.list(U.max, { limit: 20 })).items.map((n) => n.type)).toEqual([
      'PAYROLL_REMINDER',
    ]);
    expect((await h.queries.list(U.olivia, { limit: 20 })).items).toHaveLength(1);
    expect((await h.queries.list(U.hana, { limit: 20 })).items).toEqual([]);
  });

  it('thu grant Kế toán ⇒ nhắc cũ biến khỏi chuông NGAY (list + unread); cấp lại ⇒ hiện lại', async () => {
    const h = withAccountant();
    await h.notifyInTx({
      type: 'PAYROLL_REMINDER',
      refId: RUN,
      actorId: U.pam,
      recipient: { kind: 'payroll' },
    });
    expect(await h.queries.unreadCount(U.max)).toBe(1);
    h.audience.set(U.max, false, false);
    expect((await h.queries.list(U.max, { limit: 20 })).items).toEqual([]);
    expect(await h.queries.unreadCount(U.max)).toBe(0);
    h.audience.set(U.max, false, true);
    expect(await h.queries.unreadCount(U.max)).toBe(1);
  });

  it('isVisible: loại HR và loại Kế toán độc lập (có hr không mở payroll và ngược lại); hai tập không giao', () => {
    const at = new Date(0);
    const n = (type: 'PAYROLL_REMINDER' | 'LEAVE_SUBMITTED') => ({
      id: 'x',
      recipientId: 'me',
      type,
      refId: 'r',
      actorId: null,
      readAt: null,
      createdAt: at,
    });
    const scope = (hr: boolean, payroll: boolean) => ({
      recipientId: 'me',
      access: { since: at, hr, payroll },
    });
    expect(isVisible(n('PAYROLL_REMINDER'), scope(true, false))).toBe(false);
    expect(isVisible(n('PAYROLL_REMINDER'), scope(false, true))).toBe(true);
    expect(isVisible(n('LEAVE_SUBMITTED'), scope(false, true))).toBe(false);
    expect(isVisible(n('LEAVE_SUBMITTED'), scope(true, false))).toBe(true);
    expect(PAYROLL_AUDIENCE_TYPES.filter((t) => HR_AUDIENCE_TYPES.includes(t))).toEqual([]);
  });
});

describe('ngữ cảnh phiếu lương', () => {
  it('PAYSLIP_PUBLISHED ⇒ payslip.period (theo id phiếu), không số tiền; loại khác ⇒ payslip null', async () => {
    const h = withAccountant();
    h.context.payslips.set(SLIP, '2026-10');
    await h.notifyInTx({
      type: 'PAYSLIP_PUBLISHED',
      refId: SLIP,
      actorId: U.max,
      recipient: { kind: 'user', userId: U.mia },
    });
    await h.notifyInTx({
      type: 'ATTENDANCE_ADJUSTED',
      refId: SLIP,
      actorId: U.hana,
      recipient: { kind: 'user', userId: U.mia },
    });
    const items = (await h.queries.list(U.mia, { limit: 20 })).items;
    for (const item of items) expect(NotificationDto.parse(item)).toEqual(item);
    expect(items.find((n) => n.type === 'PAYSLIP_PUBLISHED')?.payslip).toEqual({
      period: '2026-10',
    });
    expect(items.find((n) => n.type === 'ATTENDANCE_ADJUSTED')?.payslip).toBeNull();
    expect(JSON.stringify(items)).not.toMatch(/netPay|amount|salary|Total/);
  });
});

describe('notifyOnce (job nhắc — chống lặp theo refId)', () => {
  it('cùng (type, refId) lần 2 ⇒ false, không thêm dòng; refId khác ⇒ gửi; actor null (hệ thống) vẫn tới người nhận', async () => {
    const h = withAccountant();
    const remind = (refId: string) =>
      h.uow.run(() =>
        h.publisher.notifyOnce({
          type: 'PAYROLL_REMINDER',
          refId,
          actorId: null,
          recipient: { kind: 'payroll' },
        }),
      );
    expect(await remind(RUN)).toBe(true);
    expect(await remind(RUN)).toBe(false);
    expect(await remind(SLIP)).toBe(true);
    const items = (await h.queries.list(U.max, { limit: 20 })).items;
    expect(items.map((n) => [n.type, n.refId, n.actor])).toEqual([
      ['PAYROLL_REMINDER', SLIP, null],
      ['PAYROLL_REMINDER', RUN, null],
    ]);
  });
});
